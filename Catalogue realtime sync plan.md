# Tilting Heads — Real-Time Catalogue Sync
## End-to-end implementation plan (no-database architecture)

**Target:** a change in Shopify Admin appears in the catalogue within ~10 seconds, with no manual script runs and no stale data.

**Scope:** Tilting Heads (`brand_id=20`) first, structured so the other four stores drop in without a rewrite.

---

## Architecture

```
                    ┌─────────────────────────────┐
   Shopify Admin ──▶│  POST /webhooks/shopify     │  verify HMAC → 200 in <50ms
   (product edit)   │  (raw body, no json parse)  │
                    └──────────────┬──────────────┘
                                   │ enqueue
                                   ▼
                    ┌─────────────────────────────┐
                    │  In-process job queue       │  serial, 1 concurrency
                    └──────────────┬──────────────┘
                                   │ GraphQL refetch (single product)
                                   ▼
                    ┌─────────────────────────────┐
                    │  CatalogueStore (in memory) │  Map<productId, Product>
                    │  + snapshot.json on disk    │
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    │  GET /api/v1/catalogue/...  │  reads memory, ~1ms
                    └──────────────┬──────────────┘
                                   ▼
                          Catalogue frontend
```

**Three things keep it correct:**
1. **Webhooks** — the fast path (seconds)
2. **Reconciliation timer** — the correctness guarantee (catches dropped webhooks)
3. **Boot sync** — cold start from snapshot, then reconcile

---

# PHASE 0 — Put the taxonomy into Shopify

**Why this is first:** the 16 catalogue categories exist only in a local mapping I derived by string-matching titles. Shopify doesn't know about them. Wire up webhooks without this and every new product arrives `Uncategorized`.

### 0.1 — Create the metafield definition

Shopify Admin → Settings → Custom data → Products → Add definition:

| Field | Value |
|---|---|
| Name | Catalogue Category |
| Namespace and key | `custom.catalogue_category` |
| Type | Single line text |
| Validation | List of values (paste the 16 categories) |

The 16 values:
```
Walk & Adventure
Groom & Care
Rest & Comfort
Play & Instinct
Feed & Hydrate
Season's Need
Travel & On-the-Go
Scratch & Climb
Home & Hygiene
Wear Your Bond
Health & First Aid
Training & Behavior
Treats & Food
Care Kits & Combos
Personality Patches
Give Back
```

Using a validated list matters — it stops typos creating phantom categories.

### 0.2 — Backfill all 306 products

Mutation, batched 25 at a time:

```graphql
mutation SetCategory($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { key value }
    userErrors { field message }
  }
}
```

```js
// variables shape
{
  metafields: [
    {
      ownerId: "gid://shopify/Product/1234567890",
      namespace: "custom",
      key: "catalogue_category",
      type: "single_line_text_field",
      value: "Walk & Adventure"
    },
    // ...24 more
  ]
}
```

Source data: the `products.json` mapping (306 rows, handle → category). Needs handle→product GID resolution first — one `products(query:"handle:X")` lookup pass, or pull GIDs during the initial sync in Phase 1 and backfill after.

**[CHECK]** After backfill, run a query filtering on the metafield and confirm the count is 306 with zero nulls.

### 0.3 — Process change

Whoever adds products from now on must set this field. Consider making it required in your internal product-creation checklist — the reconciliation job (Phase 3) will flag missing values, but a product with no category still can't render.

---

# PHASE 1 — Catalogue store + initial sync

### 1.1 — Module layout

```
src/modules/catalogue/
  catalogueStore.js        # the in-memory Map + snapshot read/write
  catalogueSync.js         # full sync + single-product refetch
  catalogueNormalize.js    # Shopify GraphQL node → catalogue product shape
  catalogueQueue.js        # serial job queue
  catalogueWebhooks.js     # HMAC verify + handlers
src/routes/catalogueRoutes.js
scripts/catalogue-initial-sync.js
data/catalogue-snapshot-20.json     # per brand_id
```

### 1.2 — The store

```js
// catalogueStore.js
const fs = require('fs/promises');
const path = require('path');

class CatalogueStore {
  constructor(brandId) {
    this.brandId = brandId;
    this.products = new Map();      // shopifyProductId -> normalized product
    this.lastSyncAt = null;         // ISO string, for reconciliation window
    this.snapshotPath = path.join(__dirname, `../../../data/catalogue-snapshot-${brandId}.json`);
  }

  upsert(product) {
    const existing = this.products.get(product.id);
    // ordering guard: never let an older webhook overwrite a newer state
    if (existing && new Date(product.updatedAt) < new Date(existing.updatedAt)) {
      return false;
    }
    this.products.set(product.id, product);
    return true;
  }

  remove(productId) { return this.products.delete(productId); }

  all() { return Array.from(this.products.values()); }

  byCategory() {
    const grouped = {};
    for (const p of this.products.values()) {
      const c = p.category || 'Uncategorized';
      (grouped[c] ||= []).push(p);
    }
    return grouped;
  }

  async saveSnapshot() {
    const payload = {
      brandId: this.brandId,
      lastSyncAt: this.lastSyncAt,
      savedAt: new Date().toISOString(),
      products: this.all(),
    };
    const tmp = `${this.snapshotPath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(payload));
    await fs.rename(tmp, this.snapshotPath);   // atomic, avoids torn file on crash
  }

  async loadSnapshot() {
    try {
      const raw = JSON.parse(await fs.readFile(this.snapshotPath, 'utf8'));
      raw.products.forEach(p => this.products.set(p.id, p));
      this.lastSyncAt = raw.lastSyncAt;
      return true;
    } catch { return false; }
  }
}
```

**Note the atomic snapshot write** — write to `.tmp` then rename. A crash mid-write otherwise leaves a truncated JSON file that fails to parse on next boot.

### 1.3 — Normalized product shape

Keep this identical to what the current HTML generator consumes, so the frontend needs no rework:

```js
{
  id: "gid://shopify/Product/123",
  handle: "rover-raincoat-...",
  title: "Rover Raincoat",
  description: "...",          // HTML stripped, trimmed to ~210 chars
  descriptionFull: "...",      // keep full for detail views later
  category: "Season's Need",   // from custom.catalogue_category metafield
  productType: "",
  tags: [],
  status: "ACTIVE",
  image: "https://cdn.shopify.com/...",
  images: [...],
  priceMin: 1799,
  priceMax: 1799,
  compareAt: 2499,
  sku: "TH-RAIN-COB-S",
  variantCount: 40,
  variants: [{ sku, title, price, compareAtPrice, inventoryQuantity, inventoryItemId }],
  inventoryTotal: 691,
  updatedAt: "2026-07-22T09:14:22Z"
}
```

**`inventoryItemId` on each variant is not optional** — Phase 2 needs it to resolve `inventory_levels/update` webhooks, which don't tell you which product they belong to.

### 1.4 — Full sync query

```graphql
query FullSync($cursor: String) {
  products(first: 50, after: $cursor, query: "status:active") {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        id handle title descriptionHtml productType tags status updatedAt
        featuredImage { url altText }
        images(first: 5) { edges { node { url altText } } }
        metafield(namespace: "custom", key: "catalogue_category") { value }
        variants(first: 100) {
          edges {
            node {
              id sku title price compareAtPrice inventoryQuantity
              inventoryItem { id }
            }
          }
        }
      }
    }
  }
}
```

**Page size 50, not 100.** With variants(100) nested, a 100-product page can exceed the single-query cost ceiling. Read `extensions.cost.throttleStatus.currentlyAvailable` from each response and sleep when it drops below ~200 rather than using a fixed delay.

### 1.5 — Boot sequence

```js
async function bootCatalogue(brandId) {
  const store = new CatalogueStore(brandId);
  const restored = await store.loadSnapshot();

  if (!restored) {
    await fullSync(store);              // cold start, ~30-60s
  } else {
    await reconcile(store);             // warm start, only fetch what changed
  }

  await store.saveSnapshot();
  startReconcileTimer(store);
  return store;
}
```

**[CHECK]** After first full sync: 306 products in the Map, zero with `category === 'Uncategorized'`, snapshot file present on disk.

---

# PHASE 2 — Webhook ingestion

### 2.1 — Register webhooks

| Topic | Why |
|---|---|
| `products/create` | new product |
| `products/update` | title, price, description, image, status |
| `products/delete` | removal |
| `collections/update` | only if you later drive categories from collections |
| `inventory_levels/update` | stock changes (drives the "Out of stock" chip) |

Register via `webhookSubscriptionCreate` or in the Shopify Admin under Settings → Notifications → Webhooks. Point all at `https://api.yourdomain.com/webhooks/shopify`.

### 2.2 — Raw body — the #1 silent failure

HMAC is computed over the **raw request bytes**. If `express.json()` runs first, the body is already parsed and re-serialising it produces different bytes. HMAC never matches, every webhook 401s, and nothing looks broken except the catalogue quietly going stale.

```js
// MUST be mounted before app.use(express.json())
app.use('/webhooks/shopify', express.raw({ type: 'application/json' }));
```

### 2.3 — Verify and acknowledge fast

Shopify's timeout is ~5 seconds. Do not refetch inside the handler — enqueue and return immediately.

```js
const crypto = require('crypto');

function verifyShopifyHmac(rawBody, hmacHeader, secret) {
  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  const a = Buffer.from(digest);
  const b = Buffer.from(hmacHeader || '');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

app.post('/webhooks/shopify', (req, res) => {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;

  if (!verifyShopifyHmac(req.body, req.get('X-Shopify-Hmac-Sha256'), secret)) {
    return res.sendStatus(401);
  }

  const webhookId = req.get('X-Shopify-Webhook-Id');
  const topic     = req.get('X-Shopify-Topic');
  const shop      = req.get('X-Shopify-Shop-Domain');

  if (seenWebhookIds.has(webhookId)) return res.sendStatus(200);  // duplicate
  seenWebhookIds.add(webhookId);                                   // LRU, cap ~5000

  catalogueQueue.push({ topic, shop, payload: JSON.parse(req.body) });
  res.sendStatus(200);
});
```

**Idempotency matters** because Shopify retries on any non-2xx, and a slow response can be retried even after it eventually succeeded. Dedupe on `X-Shopify-Webhook-Id` with a bounded LRU set.

### 2.4 — Async processing

```js
async function processJob({ topic, payload }, store) {
  switch (topic) {
    case 'products/create':
    case 'products/update': {
      // Webhook payloads are partial — no metafields, truncated images.
      // Always refetch the single product via GraphQL.
      const gid = `gid://shopify/Product/${payload.id}`;
      const fresh = await fetchSingleProduct(gid);

      if (!fresh || fresh.status !== 'ACTIVE') {
        store.remove(gid);                  // drafted/archived = drop from catalogue
      } else {
        store.upsert(normalize(fresh));
      }
      break;
    }

    case 'products/delete':
      store.remove(`gid://shopify/Product/${payload.id}`);
      break;

    case 'inventory_levels/update': {
      // payload has inventory_item_id, NOT product_id
      const product = findProductByInventoryItem(store, payload.inventory_item_id);
      if (product) {
        const fresh = await fetchSingleProduct(product.id);
        if (fresh) store.upsert(normalize(fresh));
      }
      break;
    }
  }
  await store.saveSnapshotDebounced();     // debounce ~10s, don't write per event
}
```

**Run the queue at concurrency 1.** Serial processing removes an entire class of race condition, and the volume doesn't justify parallelism.

**Debounce the snapshot write.** A bulk price update fires 306 webhooks; you don't want 306 disk writes.

### 2.5 — Status transitions are a real edge case

Setting a product to Draft fires `products/update`, **not** `products/delete`. If you only handle deletes, drafted products stay in the catalogue forever. The `status !== 'ACTIVE'` check above handles it — don't skip it.

**[CHECK]** Edit a product title in Shopify Admin. Within ~10s, `GET /api/v1/catalogue/20/products` reflects it. Set one to Draft — it disappears. Set it back to Active — it returns.

---

# PHASE 3 — Reconciliation (the correctness guarantee)

**This is the piece Cursor's plan omitted, and it's the difference between a demo and a system you can trust.**

Shopify retries a failed webhook 8 times over ~48 hours, then **drops it permanently and silently**. Deploy your backend during a webhook delivery and that change is gone — no error, no log, just a catalogue that's quietly wrong. Nothing else in the system will ever detect it.

### 3.1 — Incremental reconciliation

```js
async function reconcile(store) {
  const since = store.lastSyncAt || '2000-01-01T00:00:00Z';
  const startedAt = new Date().toISOString();

  // 1. pull everything changed since last sync
  const changed = await fetchProducts(`updated_at:>'${since}' AND status:active`);
  for (const node of changed) store.upsert(normalize(node));

  // 2. detect deletions — products in our store that Shopify no longer returns
  const liveIds = new Set(await fetchAllActiveProductIds());   // id-only query, cheap
  for (const p of store.all()) {
    if (!liveIds.has(p.id)) store.remove(p.id);
  }

  store.lastSyncAt = startedAt;      // use the pre-fetch timestamp, not post
  await store.saveSnapshot();
}
```

Set `lastSyncAt` to the time the reconcile *started*, not finished — otherwise changes made mid-run are missed on the next pass.

### 3.2 — Schedule

| Trigger | Interval |
|---|---|
| Incremental reconcile | every 15 min |
| Full resync + integrity check | nightly, 03:00 IST |
| On boot | always |

The id-only deletion sweep is cheap enough to run at 15 min. The full resync catches anything structurally odd.

### 3.3 — Integrity checks to log nightly

- Product count vs Shopify's total — drift means webhooks are failing
- Products with `category === 'Uncategorized'` — someone added a product without the metafield
- Products with no image
- Products with `priceMin === 0` or null
- Seconds since last successful webhook — if it's been >6h during business hours, delivery is broken

Log these somewhere you'll actually see them. A catalogue that's silently 3% wrong is worse than one that's obviously broken.

---

# PHASE 4 — Serve it

### 4.1 — Endpoints

```
GET  /api/v1/catalogue/:brandId/products
     ?category=Walk%20%26%20Adventure
     &in_stock=true
     &search=harness

GET  /api/v1/catalogue/:brandId/categories     # names + counts, for the TOC
GET  /api/v1/catalogue/:brandId/products/:handle
GET  /api/v1/catalogue/:brandId/meta           # lastSyncAt, counts, health
```

All read straight from memory. No Shopify call, no disk read, sub-millisecond.

### 4.2 — Caching

```js
res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
res.set('ETag', store.etag);     // hash of lastSyncAt + product count
```

`stale-while-revalidate` means a visitor never waits on a refresh.

### 4.3 — Frontend

The existing catalogue design stays exactly as-is. Only the data source changes: instead of values baked in at generation time, the page fetches `/api/v1/catalogue/20/products` and renders the same card grid, same category sections, same option chips.

Three ways to render, pick one:
- **SSR** — server renders HTML from the store on request. Best SEO, fastest first paint.
- **Client fetch** — ship the shell, fetch JSON, render. Simplest.
- **Regenerate static** — debounced 60s after any change, write a new HTML file. Fastest to serve, CDN-friendly, zero frontend work.

Given you want customer + wholesale + internal from one source, SSR with a query param for audience (`?view=wholesale` adds SKU/cost columns behind auth) is the cleanest long-term shape.

---

# PHASE 5 — Outputs

### 5.1 — PDF export
"Download catalogue" button → renders the same data server-side → Puppeteer → PDF. Always current, never a stale file lying around.

### 5.2 — Wholesale view
Same endpoint, auth-gated flag that includes per-variant SKU, cost price, inventory. Never expose this unauthenticated.

### 5.3 — Multi-store
Everything is keyed by `brandId` from the start. Adding The Billy Company means one config entry — store domain, token, webhook secret — and a boot call. No code changes.

---

# Environment

```bash
SHOPIFY_TH_STORE_DOMAIN=xxx.myshopify.com
SHOPIFY_TH_ADMIN_TOKEN=shpat_...
SHOPIFY_TH_WEBHOOK_SECRET=...           # from webhook registration, NOT the API secret
SHOPIFY_API_VERSION=2025-01
CATALOGUE_SNAPSHOT_DIR=/app/data
CATALOGUE_RECONCILE_INTERVAL_MIN=15
```

The webhook secret and the app API secret are different values. Mixing them up is a common cause of universal 401s.

---

# Known constraints

| Constraint | Impact | Mitigation |
|---|---|---|
| **Multiple backend replicas** | Webhook hits one instance; others serve stale | Single instance for now, or Redis pub/sub later |
| **Server down during webhook** | Change lost permanently | Reconciliation timer (Phase 3) |
| **Shopify CDN URLs rotate** | Broken images when a photo is replaced | Webhook refetch updates the URL; proxy through your domain if archiving |
| **Rate limits** | 429s during full sync | Page size 50, read `throttleStatus`, back off dynamically |
| **Memory** | ~300KB for 306 products | Negligible; revisit past ~50k products |
| **Cold start** | ~30-60s full sync | Snapshot on disk makes restarts near-instant |
| **New product missing metafield** | Renders as Uncategorized | Validated metafield list + nightly integrity check |

---

# Build order

| # | Phase | Depends on | Rough effort |
|---|---|---|---|
| 1 | Metafield definition + backfill | — | half day |
| 2 | Store, normalize, full sync | 1 | 1 day |
| 3 | Webhook registration + HMAC + queue | 2 | 1 day |
| 4 | Reconciliation timer + integrity checks | 2 | half day |
| 5 | API endpoints | 2 | half day |
| 6 | Frontend wired to API | 5 | 1 day |
| 7 | PDF + wholesale view | 6 | 1 day |

Phases 1–4 give a live, self-healing catalogue in the backend. 5–7 are presentation.

---

# When to add a database

Not yet. Add one when any of these become true:

- More than one backend instance serving the catalogue
- You want change history ("what did this price used to be")
- Cross-store search or aggregation across all five brands
- Product count into the tens of thousands
- Analytics joins against catalogue state at a point in time

Until then, the in-memory store plus disk snapshot is simpler, faster, and has fewer failure modes than Postgres would.