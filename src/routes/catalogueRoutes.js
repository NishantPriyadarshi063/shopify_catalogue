'use strict';

const express = require('express');
const axios = require('axios');
const { CATEGORIES, CATEGORY_BLURBS } = require('../modules/catalogue/catalogueCategories');
const { getBrandByBrandId, getAllConfiguredBrands } = require('../config/brands');
const repository = require('../modules/catalogue/repository');
const { streamCataloguePdf } = require('../modules/catalogue/cataloguePdf');

const SHOPIFY_CDN_HOSTS = new Set([
  'cdn.shopify.com',
  'cdn.shopifycdn.net',
]);

function isAllowedShopifyImageUrl(raw) {
  try {
    const u = new URL(String(raw || ''));
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    if (SHOPIFY_CDN_HOSTS.has(host)) return true;
    if (host.endsWith('.myshopify.com')) return true;
    if (host.endsWith('.shopify.com')) return true;
    return false;
  } catch {
    return false;
  }
}

function createCatalogueRoutes() {
  const router = express.Router();

  function resolveBrandId(req, res) {
    const brand = getBrandByBrandId(req.params.brandId);
    if (!brand) {
      res.status(404).json({ error: `Unknown brand ${req.params.brandId}` });
      return null;
    }
    return brand.brandId;
  }

  function setCacheHeaders(res) {
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  }

  function slugify(name) {
    return String(name || 'catalogue')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'catalogue';
  }

  // Proxy Shopify CDN images (same-origin → reliable original downloads)
  router.get('/:brandId/image', async (req, res) => {
    const brandId = resolveBrandId(req, res);
    if (brandId == null) return;

    const target = String(req.query.url || '');
    if (!isAllowedShopifyImageUrl(target)) {
      return res.status(400).json({ error: 'Invalid or disallowed image URL' });
    }

    try {
      const upstream = await axios.get(target, {
        responseType: 'stream',
        timeout: 60000,
        headers: { Accept: 'image/*,*/*' },
        maxRedirects: 3,
        validateStatus: (s) => s >= 200 && s < 400,
      });

      const contentType = upstream.headers['content-type'] || 'application/octet-stream';
      if (!String(contentType).startsWith('image/')) {
        return res.status(502).json({ error: 'Upstream did not return an image' });
      }

      res.set('Content-Type', contentType);
      res.set('Cache-Control', 'public, max-age=86400, immutable');
      if (upstream.headers['content-length']) {
        res.set('Content-Length', upstream.headers['content-length']);
      }
      upstream.data.pipe(res);
    } catch (err) {
      console.error('[image-proxy]', err.message || err);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Could not fetch image' });
      }
    }
  });

  // Server-side PDF — reliable (no blank html2canvas PDFs)
  router.get('/:brandId/pdf', async (req, res) => {
    const brandId = resolveBrandId(req, res);
    if (brandId == null) return;

    try {
      const products = await repository.listProducts(brandId, {
        status: 'ACTIVE',
        includeVariants: true,
      });

      const category = req.query.category ? String(req.query.category) : null;
      const filename = category
        ? `tilting-heads-${slugify(category)}.pdf`
        : 'tilting-heads-full-catalogue.pdf';

      await streamCataloguePdf(res, { products, category, filename });
    } catch (err) {
      console.error('[pdf]', err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message || 'PDF generation failed' });
      }
    }
  });

  router.get('/:brandId/meta', async (req, res) => {
    const brandId = resolveBrandId(req, res);
    if (brandId == null) return;

    try {
      const meta = await repository.getBrandMeta(brandId);
      if (!meta) {
        return res.status(404).json({
          error: `No DB data for brand ${brandId}. Run: npm run backfill -- --brand=tiltingheads`,
        });
      }
      setCacheHeaders(res);
      res.json({
        brandId: meta.brand_id,
        slug: meta.slug,
        shopDomain: meta.shop_domain,
        lastSyncedAt: meta.last_synced_at,
        productCount: meta.product_count,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/:brandId/categories', async (req, res) => {
    const brandId = resolveBrandId(req, res);
    if (brandId == null) return;

    try {
      const grouped = await repository.getCategories(brandId);
      const countByName = Object.fromEntries(grouped.map((r) => [r.category, r.count]));

      const categories = CATEGORIES
        .map((name, index) => ({
          id: index + 1,
          name,
          blurb: CATEGORY_BLURBS[name] || '',
          count: countByName[name] || 0,
        }))
        .filter((c) => c.count > 0);

      if (countByName.Uncategorized) {
        categories.push({
          id: 99,
          name: 'Uncategorized',
          blurb: 'Products missing a catalogue category — set custom.catalogue_category in Shopify.',
          count: countByName.Uncategorized,
        });
      }

      setCacheHeaders(res);
      res.json({ categories });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/:brandId/products', async (req, res) => {
    const brandId = resolveBrandId(req, res);
    if (brandId == null) return;

    try {
      let products = await repository.listProducts(brandId, {
        status: 'ACTIVE',
        category: req.query.category || null,
        includeVariants: false,
      });

      const { in_stock: inStock, search } = req.query;
      if (inStock === 'true') {
        products = products.filter((p) => p.inventoryTotal > 0);
      }
      if (search) {
        const q = String(search).toLowerCase();
        products = products.filter(
          (p) =>
            p.title.toLowerCase().includes(q)
            || p.handle.toLowerCase().includes(q)
            || (p.sku || '').toLowerCase().includes(q)
            || (p.tags || []).some((t) => t.toLowerCase().includes(q)),
        );
      }

      setCacheHeaders(res);
      res.json({ count: products.length, products });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/:brandId/products/:handle', async (req, res) => {
    const brandId = resolveBrandId(req, res);
    if (brandId == null) return;

    try {
      const products = await repository.listProducts(brandId, {
        status: 'ALL',
        includeVariants: true,
      });
      const product = products.find((p) => p.handle === req.params.handle);
      if (!product) {
        return res.status(404).json({ error: 'Product not found' });
      }
      setCacheHeaders(res);
      res.json({ product });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/:brandId/catalogue', async (req, res) => {
    const brandId = resolveBrandId(req, res);
    if (brandId == null) return;

    try {
      const payload = await repository.getCataloguePayload(brandId);
      if (!payload.slug && !payload.products.length) {
        return res.status(404).json({
          error: `No DB data for brand ${brandId}. Run: npm run backfill -- --brand=tiltingheads`,
        });
      }

      const grouped = {};
      for (const p of payload.products) {
        const key = p.category || 'Uncategorized';
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(p);
      }

      const sections = CATEGORIES
        .map((name, index) => ({
          id: index + 1,
          name,
          blurb: CATEGORY_BLURBS[name] || '',
          products: grouped[name] || [],
        }))
        .filter((s) => s.products.length > 0);

      if (grouped.Uncategorized?.length) {
        sections.push({
          id: 99,
          name: 'Uncategorized',
          blurb: 'Products missing a catalogue category.',
          products: grouped.Uncategorized,
        });
      }

      setCacheHeaders(res);
      res.json({
        meta: {
          brandId: payload.brandId,
          slug: payload.slug,
          shopDomain: payload.shopDomain,
          lastSyncedAt: payload.lastSyncedAt,
          productCount: payload.productCount,
          inStockCount: payload.inStockCount,
        },
        sections,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/', (req, res) => {
    res.json({
      message: 'Catalogue API (Postgres-backed)',
      example: '/api/v1/catalogue/20/catalogue',
      brands: getAllConfiguredBrands().map((b) => ({
        brandId: b.brandId,
        slug: b.slug,
        shopDomain: b.shopDomain,
      })),
    });
  });

  return router;
}

module.exports = { createCatalogueRoutes };
