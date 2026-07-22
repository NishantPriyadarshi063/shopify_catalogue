'use strict';

const { resolveCategory } = require('./catalogueCategories');

function stripHtml(html) {
  if (!html) return '';
  return String(html)
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function shortDescription(full, max = 210) {
  if (!full) return '';
  if (full.length <= max) return full;
  const cut = full.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 120 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Shopify GraphQL product node → catalogue product shape
 */
function normalizeProduct(node) {
  const variants = (node.variants?.edges || []).map((e) => {
    const v = e.node;
    return {
      id: v.id,
      sku: v.sku || '',
      title: v.title || '',
      price: toNumber(v.price) ?? 0,
      compareAtPrice: toNumber(v.compareAtPrice),
      inventoryQuantity: Number(v.inventoryQuantity ?? 0),
      inventoryItemId: v.inventoryItem?.id || null,
    };
  });

  const prices = variants.map((v) => v.price).filter((p) => p != null);
  const priceMin = prices.length ? Math.min(...prices) : 0;
  const priceMax = prices.length ? Math.max(...prices) : 0;

  const onSaleCompares = variants
    .filter((v) => v.compareAtPrice != null && v.compareAtPrice > v.price)
    .map((v) => v.compareAtPrice);
  const compareAt = onSaleCompares.length ? Math.max(...onSaleCompares) : null;

  const images = (node.images?.edges || []).map((e) => ({
    url: e.node.url,
    altText: e.node.altText || '',
  }));
  const featured = node.featuredImage?.url || images[0]?.url || '';

  const descriptionFull = stripHtml(node.descriptionHtml);
  const sampleSku = variants.find((v) => v.sku)?.sku || '';
  const tags = Array.isArray(node.tags) ? node.tags : [];

  const category = resolveCategory({
    metafieldValue: node.metafield?.value,
    title: node.title,
    sku: sampleSku,
    tags,
    productType: node.productType,
  });

  const inventoryTotal = variants.reduce((sum, v) => sum + (v.inventoryQuantity || 0), 0);

  return {
    id: node.id,
    handle: node.handle || '',
    title: node.title || '',
    description: shortDescription(descriptionFull),
    descriptionFull,
    category,
    productType: node.productType || '',
    tags,
    status: String(node.status || '').toUpperCase(),
    image: featured,
    images,
    priceMin,
    priceMax,
    compareAt,
    sku: sampleSku,
    variantCount: variants.length,
    variants,
    inventoryTotal,
    updatedAt: node.updatedAt || new Date().toISOString(),
  };
}

module.exports = {
  normalizeProduct,
  stripHtml,
  shortDescription,
};
