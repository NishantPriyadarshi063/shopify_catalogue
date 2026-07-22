'use strict';

/**
 * Brand-wise Shopify → Postgres backfill.
 *
 *   node scripts/backfill.js
 *   node scripts/backfill.js --brand=tiltingheads
 *   node scripts/backfill.js --all
 */

require('dotenv').config();

const { getBrandBySlug, getAllConfiguredBrands } = require('../src/config/brands');
const { backfillBrand } = require('../src/modules/catalogue/catalogueSync');
const { closePool } = require('../src/config/database');

function parseArgs() {
  const all = process.argv.includes('--all');
  const arg = process.argv.find((a) => a.startsWith('--brand='));
  const brand = arg
    ? arg.slice('--brand='.length)
    : (process.env.CATALOGUE_DEFAULT_BRAND || 'tiltingheads');
  return { all, brand };
}

async function main() {
  const { all, brand: slug } = parseArgs();
  const brands = all
    ? getAllConfiguredBrands()
    : [getBrandBySlug(slug)].filter(Boolean);

  if (!brands.length) {
    throw new Error(
      all
        ? 'No brands configured (need SHOPIFY_*_SHOP_DOMAIN + ACCESS_TOKEN)'
        : `Brand not configured: ${slug}`,
    );
  }

  const results = [];
  for (const brand of brands) {
    const meta = await backfillBrand(brand, {
      onProgress: ({ page, count }) => {
        process.stdout.write(`\r[${brand.slug}] page ${page}, ${count} products...`);
      },
    });
    process.stdout.write('\n');
    results.push(meta);
  }

  console.log(JSON.stringify(results, null, 2));
  await closePool();
}

main().catch(async (err) => {
  console.error(err.message || err);
  try { await closePool(); } catch { /* ignore */ }
  process.exit(1);
});
