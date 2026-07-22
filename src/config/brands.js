'use strict';

/**
 * Multi-store brand registry.
 * Env vars: SHOPIFY_{SLUG}_SHOP_DOMAIN + SHOPIFY_{SLUG}_ACCESS_TOKEN
 */

const DEFAULT_BRAND_IDS = {
  tiltingheads: 20,
  billicompany: 21,
  mannmore: 22,
  urthend: 23,
  snifftheory: 24,
};

const SLUGS = Object.keys(DEFAULT_BRAND_IDS);

function envKey(slug, suffix) {
  return `SHOPIFY_${slug.toUpperCase()}_${suffix}`;
}

function loadBrand(slug) {
  const shopDomain = process.env[envKey(slug, 'SHOP_DOMAIN')];
  const accessToken =
    process.env[envKey(slug, 'ACCESS_TOKEN')]
    || process.env[envKey(slug, 'ADMIN_TOKEN')];

  if (!shopDomain || !accessToken) {
    return null;
  }

  return {
    slug,
    brandId: Number(process.env[envKey(slug, 'BRAND_ID')] || DEFAULT_BRAND_IDS[slug] || 0),
    shopDomain: String(shopDomain).replace(/^https?:\/\//i, '').replace(/\/+$/, ''),
    accessToken: String(accessToken).trim(),
  };
}

function getAllConfiguredBrands() {
  return SLUGS.map(loadBrand).filter(Boolean);
}

function getBrandBySlug(slug) {
  return loadBrand(String(slug || '').toLowerCase());
}

function getBrandByBrandId(brandId) {
  const id = String(brandId);
  return getAllConfiguredBrands().find((b) => String(b.brandId) === id || b.slug === id) || null;
}

module.exports = {
  SLUGS,
  DEFAULT_BRAND_IDS,
  getAllConfiguredBrands,
  getBrandBySlug,
  getBrandByBrandId,
};
