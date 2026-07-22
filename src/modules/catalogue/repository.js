'use strict';

const { withClient, query } = require('../../config/database');

async function upsertBrand(brand) {
  await query(
    `INSERT INTO brands (brand_id, slug, shop_domain, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (brand_id) DO UPDATE SET
       slug = EXCLUDED.slug,
       shop_domain = EXCLUDED.shop_domain,
       updated_at = NOW()`,
    [brand.brandId, brand.slug, brand.shopDomain]
  );
}

async function replaceBrandCatalogue(brand, products) {
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query(
        `INSERT INTO brands (brand_id, slug, shop_domain, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (brand_id) DO UPDATE SET
           slug = EXCLUDED.slug,
           shop_domain = EXCLUDED.shop_domain,
           updated_at = NOW()`,
        [brand.brandId, brand.slug, brand.shopDomain]
      );

      // Full replace for this brand so deleted Shopify products disappear
      await client.query('DELETE FROM catalogue_products WHERE brand_id = $1', [brand.brandId]);

      for (const p of products) {
        await client.query(
          `INSERT INTO catalogue_products (
            id, brand_id, handle, title, description, description_full, category,
            product_type, tags, status, image_url, images, price_min, price_max,
            compare_at, sku, variant_count, inventory_total, shopify_updated_at, synced_at
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17,$18,$19,NOW()
          )`,
          [
            p.id,
            brand.brandId,
            p.handle,
            p.title,
            p.description || '',
            p.descriptionFull || '',
            p.category || 'Uncategorized',
            p.productType || '',
            p.tags || [],
            p.status || 'ACTIVE',
            p.image || p.imageUrl || '',
            JSON.stringify(p.images || []),
            p.priceMin ?? 0,
            p.priceMax ?? 0,
            p.compareAt ?? null,
            p.sku || '',
            p.variantCount ?? (p.variants || []).length,
            p.inventoryTotal ?? 0,
            p.updatedAt ? new Date(p.updatedAt) : null,
          ]
        );

        for (const v of p.variants || []) {
          await client.query(
            `INSERT INTO catalogue_variants (
              id, brand_id, product_id, sku, title, price, compare_at_price,
              inventory_quantity, inventory_item_id, synced_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
            [
              v.id,
              brand.brandId,
              p.id,
              v.sku || '',
              v.title || '',
              v.price ?? 0,
              v.compareAtPrice ?? null,
              v.inventoryQuantity ?? 0,
              v.inventoryItemId || null,
            ]
          );
        }
      }

      await client.query(
        `UPDATE brands
         SET last_synced_at = NOW(),
             product_count = $2,
             updated_at = NOW()
         WHERE brand_id = $1`,
        [brand.brandId, products.length]
      );

      await client.query('COMMIT');
      return { productCount: products.length };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}

function mapProductRow(row, variants = []) {
  return {
    id: row.id,
    handle: row.handle,
    title: row.title,
    description: row.description,
    descriptionFull: row.description_full,
    category: row.category,
    productType: row.product_type,
    tags: row.tags || [],
    status: row.status,
    image: row.image_url,
    imageUrl: row.image_url,
    images: row.images || [],
    priceMin: Number(row.price_min),
    priceMax: Number(row.price_max),
    compareAt: row.compare_at != null ? Number(row.compare_at) : null,
    sku: row.sku,
    variantCount: row.variant_count,
    inventoryTotal: row.inventory_total,
    updatedAt: row.shopify_updated_at,
    syncedAt: row.synced_at,
    variants: variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      title: v.title,
      price: Number(v.price),
      compareAtPrice: v.compare_at_price != null ? Number(v.compare_at_price) : null,
      inventoryQuantity: v.inventory_quantity,
      inventoryItemId: v.inventory_item_id,
    })),
  };
}

async function getBrandMeta(brandId) {
  const { rows } = await query(
    `SELECT brand_id, slug, shop_domain, last_synced_at, product_count
     FROM brands WHERE brand_id = $1`,
    [brandId]
  );
  return rows[0] || null;
}

async function listProducts(brandId, { status = 'ACTIVE', category = null, includeVariants = false } = {}) {
  const params = [brandId];
  let sql = `
    SELECT * FROM catalogue_products
    WHERE brand_id = $1
  `;

  if (status && status !== 'ALL') {
    params.push(status);
    sql += ` AND status = $${params.length}`;
  }

  if (category) {
    params.push(category);
    sql += ` AND category = $${params.length}`;
  }

  sql += ' ORDER BY title ASC';

  const { rows } = await query(sql, params);

  if (!includeVariants) {
    return rows.map((r) => mapProductRow(r));
  }

  const { rows: variantRows } = await query(
    `SELECT * FROM catalogue_variants WHERE brand_id = $1 ORDER BY sku ASC`,
    [brandId]
  );

  const byProduct = new Map();
  for (const v of variantRows) {
    if (!byProduct.has(v.product_id)) byProduct.set(v.product_id, []);
    byProduct.get(v.product_id).push(v);
  }

  return rows.map((r) => mapProductRow(r, byProduct.get(r.id) || []));
}

async function getProductById(brandId, productId) {
  const { rows } = await query(
    `SELECT * FROM catalogue_products WHERE brand_id = $1 AND id = $2`,
    [brandId, productId]
  );
  if (!rows[0]) return null;

  const { rows: variants } = await query(
    `SELECT * FROM catalogue_variants WHERE brand_id = $1 AND product_id = $2 ORDER BY sku ASC`,
    [brandId, productId]
  );

  return mapProductRow(rows[0], variants);
}

async function getCategories(brandId) {
  const { rows } = await query(
    `SELECT category, COUNT(*)::int AS count
     FROM catalogue_products
     WHERE brand_id = $1 AND status = 'ACTIVE'
     GROUP BY category
     ORDER BY category ASC`,
    [brandId]
  );
  return rows;
}

async function getCataloguePayload(brandId) {
  const meta = await getBrandMeta(brandId);
  const products = await listProducts(brandId, { status: 'ACTIVE', includeVariants: true });
  const categories = await getCategories(brandId);

  const inStock = products.filter((p) => p.inventoryTotal > 0).length;

  return {
    brandId,
    slug: meta?.slug || null,
    shopDomain: meta?.shop_domain || null,
    lastSyncedAt: meta?.last_synced_at || null,
    productCount: products.length,
    inStockCount: inStock,
    categories,
    products,
  };
}

module.exports = {
  upsertBrand,
  replaceBrandCatalogue,
  getBrandMeta,
  listProducts,
  getProductById,
  getCategories,
  getCataloguePayload,
};
