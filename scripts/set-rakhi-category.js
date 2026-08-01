'use strict';

/**
 * Set festive Rakhi products to Wear Your Bond via Shopify metafield.
 *
 *   node scripts/set-rakhi-category.js
 *   node scripts/set-rakhi-category.js --dry-run
 */

require('dotenv').config();

const { getBrandBySlug } = require('../src/config/brands');
const { shopifyGraphql, backfillBrand } = require('../src/modules/catalogue/catalogueSync');
const { closePool } = require('../src/config/database');

const CATEGORY = 'Wear Your Bond';
const DRY_RUN = process.argv.includes('--dry-run');

const SET_METAFIELDS = `
  mutation SetCategory($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { namespace key value }
      userErrors { field message }
    }
  }
`;

async function findRakhiProducts(brand) {
  const data = await shopifyGraphql(
    brand,
    `query FindRakhis($query: String!) {
      products(first: 50, query: $query) {
        edges {
          node {
            id
            handle
            title
            status
            metafield(namespace: "custom", key: "catalogue_category") { value }
            variants(first: 10) {
              edges { node { sku } }
            }
          }
        }
      }
    }`,
    { query: 'status:active rakhi' },
  );

  return (data?.products?.edges || []).map((e) => e.node);
}

async function main() {
  const brand = getBrandBySlug('tiltingheads');
  if (!brand) {
    throw new Error('Brand not configured: tiltingheads');
  }

  const products = await findRakhiProducts(brand);
  if (!products.length) {
    throw new Error('No active products matched query "rakhi"');
  }

  console.log(`Found ${products.length} rakhi product(s):\n`);
  for (const p of products) {
    const skus = (p.variants?.edges || []).map((v) => v.node.sku).filter(Boolean);
    console.log(`- ${p.title}`);
    console.log(`  handle: ${p.handle}`);
    console.log(`  current: ${p.metafield?.value || '(none)'} → ${CATEGORY}`);
    if (skus.length) console.log(`  skus: ${skus.join(', ')}`);
  }

  if (DRY_RUN) {
    console.log('\nDry run — no Shopify changes.');
    return;
  }

  const metafields = products.map((p) => ({
    ownerId: p.id,
    namespace: 'custom',
    key: 'catalogue_category',
    type: 'single_line_text_field',
    value: CATEGORY,
  }));

  const result = await shopifyGraphql(brand, SET_METAFIELDS, { metafields });
  const errors = result?.metafieldsSet?.userErrors || [];
  if (errors.length) {
    throw new Error(errors.map((e) => e.message).join('; '));
  }

  console.log(`\nSet ${result.metafieldsSet.metafields.length} metafield(s) to "${CATEGORY}".`);
  console.log('Refreshing catalogue DB…');

  await backfillBrand(brand, {
    onProgress: ({ page, count }) => {
      process.stdout.write(`\r[backfill] page ${page}, ${count} products…`);
    },
  });
  process.stdout.write('\nDone.\n');
}

main()
  .catch(async (err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await closePool();
    } catch {
      /* ignore */
    }
  });
