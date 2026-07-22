'use strict';

/**
 * One-shot full sync for a brand (writes snapshot, exits).
 *
 *   node scripts/catalogue-initial-sync.js
 *   node scripts/catalogue-initial-sync.js --brand=tiltingheads
 */

require('dotenv').config();

const { getBrandBySlug, getAllConfiguredBrands } = require('../src/config/brands');
const { CatalogueStore } = require('../src/modules/catalogue/catalogueStore');
const { fullSync } = require('../src/modules/catalogue/catalogueSync');

function parseBrand() {
  const arg = process.argv.find((a) => a.startsWith('--brand='));
  if (arg) return arg.slice('--brand='.length);
  return process.env.CATALOGUE_DEFAULT_BRAND || 'tiltingheads';
}

async function main() {
  const slug = parseBrand();
  const brand = getBrandBySlug(slug) || getAllConfiguredBrands()[0];
  if (!brand) {
    throw new Error(`Brand not configured: ${slug}`);
  }

  const store = new CatalogueStore(brand);
  const meta = await fullSync(store, {
    onProgress: ({ page, count }) => {
      process.stdout.write(`\rpage ${page}, ${count} products...`);
    },
  });
  process.stdout.write('\n');
  console.log(JSON.stringify(meta, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
