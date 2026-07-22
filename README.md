# Tilting Heads Catalogue (standalone)

Postgres-backed Shopify catalogue. Backfill brand-wise from Shopify Admin GraphQL, then serve the UI/API from the DB.

## Quick start (local)

```bash
cd CATALOGUE
npm install
npm run migrate
npm run backfill -- --brand=tiltingheads
npm start
```

Open **http://localhost:5050**.

## Docker deploy

Requires a `.env` with `DATABASE_URL` and Shopify brand tokens (see `.env.example`).

```bash
cd CATALOGUE
docker compose build
docker compose --profile tools run --rm migrate
docker compose up -d
```

App: **http://localhost:5050**

Backfill runs **automatically every 30 minutes** inside the server (and once shortly after boot). Manual backfill is optional:

```bash
docker compose logs -f catalogue
docker compose --profile tools run --rm backfill
docker compose --profile tools run --rm backfill node scripts/backfill.js --all
docker compose down
```

## Auto backfill

| Env | Default | Meaning |
|---|---|---|
| `CATALOGUE_BACKFILL_ENABLED` | `true` | Turn cron on/off |
| `CATALOGUE_BACKFILL_INTERVAL_MIN` | `30` | Minutes between runs |
| `CATALOGUE_BACKFILL_ON_BOOT` | `true` | Run once after startup |
| `CATALOGUE_BACKFILL_BOOT_DELAY_SEC` | `10` | Delay before first boot run |
| `CATALOGUE_BACKFILL_BRANDS` | _(empty)_ | Comma list of slugs; empty = all brands |

Status is on `GET /health` → `backfill`.

## Scripts

| Command | Description |
|---|---|
| `npm run migrate` | Apply SQL schema to `DATABASE_URL` |
| `npm run backfill` | Backfill default brand (Tilting Heads) |
| `npm run backfill -- --brand=billicompany` | Backfill one brand |
| `npm run backfill -- --all` | Backfill every configured brand |

## API

| Endpoint | Description |
|---|---|
| `GET /api/v1/catalogue/20/catalogue` | Full catalogue grouped by category |
| `GET /api/v1/catalogue/20/products` | Flat product list (`?category=&search=&in_stock=true`) |
| `GET /api/v1/catalogue/20/categories` | Category names + counts |
| `GET /api/v1/catalogue/20/meta` | Last sync + product count |
| `GET /health` | DB brands summary |

Refresh data by re-running backfill (local or Docker tools profile).

## Env

- `DATABASE_URL` — Postgres URL (`?schema=shopify&sslmode=require` supported)
- `SHOPIFY_{SLUG}_SHOP_DOMAIN` + `SHOPIFY_{SLUG}_ACCESS_TOKEN` per brand

Brand IDs (defaults): Tilting Heads `20`, Billy `21`, Mannmore `22`, Urthend `23`, Sniff Theory `24`.
