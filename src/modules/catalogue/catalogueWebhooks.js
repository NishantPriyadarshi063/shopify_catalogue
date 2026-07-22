'use strict';

const crypto = require('crypto');
const { getBrandByShopDomain } = require('../../config/brands');
const { fetchSingleProduct } = require('./catalogueSync');
const { normalizeProduct } = require('./catalogueNormalize');

const seenWebhookIds = new Set();
const SEEN_CAP = 5000;

function rememberWebhookId(id) {
  if (!id) return false;
  if (seenWebhookIds.has(id)) return true;
  seenWebhookIds.add(id);
  if (seenWebhookIds.size > SEEN_CAP) {
    const first = seenWebhookIds.values().next().value;
    seenWebhookIds.delete(first);
  }
  return false;
}

function verifyShopifyHmac(rawBody, hmacHeader, secret) {
  if (!secret || !hmacHeader) return false;
  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  const a = Buffer.from(digest);
  const b = Buffer.from(hmacHeader);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createWebhookRouter({ getStore, queue }) {
  const express = require('express');
  const router = express.Router();

  // express.raw is mounted in server.js for this path
  router.post('/', (req, res) => {
    const shop = req.get('X-Shopify-Shop-Domain');
    const topic = req.get('X-Shopify-Topic');
    const webhookId = req.get('X-Shopify-Webhook-Id');
    const hmac = req.get('X-Shopify-Hmac-Sha256');

    const brand = getBrandByShopDomain(shop);
    if (!brand) {
      console.warn('[webhook] unknown shop', shop);
      return res.sendStatus(404);
    }

    const secret = brand.webhookSecret;
    if (!secret) {
      console.warn('[webhook] no webhook secret configured for', brand.slug);
      // Still accept in dev so local testing can proceed with a shared secret later
      if (process.env.NODE_ENV === 'production') {
        return res.sendStatus(401);
      }
    } else if (!verifyShopifyHmac(req.body, hmac, secret)) {
      console.warn('[webhook] HMAC failed', { shop, topic });
      return res.sendStatus(401);
    }

    if (rememberWebhookId(webhookId)) {
      return res.sendStatus(200);
    }

    let payload;
    try {
      payload = JSON.parse(req.body.toString('utf8'));
    } catch {
      return res.sendStatus(400);
    }

    const store = getStore(brand.slug);
    if (!store) {
      return res.sendStatus(503);
    }

    queue.push({ topic, shop, payload, brandSlug: brand.slug });
    store.lastWebhookAt = new Date().toISOString();
    res.sendStatus(200);
  });

  return router;
}

async function processWebhookJob(job, getStore) {
  const store = getStore(job.brandSlug);
  if (!store) return;

  const { topic, payload } = job;
  const brand = store.brand;

  switch (topic) {
    case 'products/create':
    case 'products/update': {
      const gid = `gid://shopify/Product/${payload.id}`;
      const fresh = await fetchSingleProduct(brand, gid);
      if (!fresh || String(fresh.status).toUpperCase() !== 'ACTIVE') {
        store.remove(gid);
      } else {
        store.upsert(normalizeProduct(fresh));
      }
      break;
    }

    case 'products/delete': {
      store.remove(`gid://shopify/Product/${payload.id}`);
      break;
    }

    case 'inventory_levels/update': {
      const invId = payload.inventory_item_id;
      const product = store.findByInventoryItemId(invId);
      if (product) {
        const fresh = await fetchSingleProduct(brand, product.id);
        if (!fresh || String(fresh.status).toUpperCase() !== 'ACTIVE') {
          store.remove(product.id);
        } else {
          store.upsert(normalizeProduct(fresh));
        }
      }
      break;
    }

    default:
      console.log('[webhook] unhandled topic', topic);
      return;
  }

  store.saveSnapshotDebounced();
  console.log(`[webhook] processed ${topic} → ${store.products.size} products`);
}

module.exports = {
  createWebhookRouter,
  processWebhookJob,
  verifyShopifyHmac,
};
