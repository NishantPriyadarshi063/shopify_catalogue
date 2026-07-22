'use strict';

const axios = require('axios');
const config = require('../../config/env');
const { normalizeProduct } = require('./catalogueNormalize');
const { replaceBrandCatalogue } = require('./repository');

const THROTTLE_MIN = 200;

const PRODUCT_FIELDS = `
  id
  handle
  title
  descriptionHtml
  productType
  tags
  status
  updatedAt
  featuredImage { url altText }
  images(first: 25) { edges { node { url altText } } }
  metafield(namespace: "custom", key: "catalogue_category") { value }
  variants(first: 100) {
    edges {
      node {
        id
        sku
        title
        price
        compareAtPrice
        inventoryQuantity
        inventoryItem { id }
      }
    }
  }
`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function shopifyGraphql(brand, query, variables = {}) {
  const url = `https://${brand.shopDomain}/admin/api/${config.apiVersion}/graphql.json`;
  const response = await axios.post(
    url,
    { query, variables },
    {
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': brand.accessToken,
      },
      timeout: 120000,
    },
  );

  if (response.data?.errors?.length) {
    throw new Error(response.data.errors.map((e) => e.message).join('; '));
  }

  const throttle = response.data?.extensions?.cost?.throttleStatus;
  if (throttle) {
    const available = Number(throttle.currentlyAvailable ?? 0);
    const restoreRate = Number(throttle.restoreRate ?? 50);
    if (available < THROTTLE_MIN) {
      const deficit = THROTTLE_MIN - available;
      const waitMs = Math.max(250, Math.ceil(deficit / restoreRate) * 1000);
      await sleep(waitMs);
    }
  }

  return response.data?.data;
}

async function fetchProductsPage(brand, { cursor = null, queryFilter = 'status:active' } = {}) {
  const query = `
    query FullSync($cursor: String, $query: String!) {
      products(first: 50, after: $cursor, query: $query) {
        pageInfo { hasNextPage endCursor }
        edges { node { ${PRODUCT_FIELDS} } }
      }
    }
  `;
  const data = await shopifyGraphql(brand, query, {
    cursor,
    query: queryFilter,
  });
  return data?.products;
}

async function fetchAllActiveProducts(brand, queryFilter = 'status:active', onPage) {
  const nodes = [];
  let cursor = null;
  let hasNextPage = true;
  let page = 0;

  while (hasNextPage) {
    page += 1;
    const products = await fetchProductsPage(brand, { cursor, queryFilter });
    if (!products) break;

    for (const edge of products.edges || []) {
      nodes.push(edge.node);
    }

    if (typeof onPage === 'function') {
      onPage({ page, count: nodes.length });
    }

    hasNextPage = products.pageInfo?.hasNextPage;
    cursor = products.pageInfo?.endCursor;
  }

  return nodes;
}

/**
 * Fetch Shopify products for a brand and upsert into Postgres.
 */
async function backfillBrand(brand, { onProgress } = {}) {
  console.log(`[backfill] start: ${brand.slug} (brand_id=${brand.brandId})`);

  const nodes = await fetchAllActiveProducts(brand, 'status:active', onProgress);
  const products = nodes.map(normalizeProduct);

  const result = await replaceBrandCatalogue(brand, products);

  console.log(`[backfill] done: ${brand.slug} → ${result.productCount} products in DB`);
  return {
    brandId: brand.brandId,
    slug: brand.slug,
    shopDomain: brand.shopDomain,
    productCount: result.productCount,
    syncedAt: new Date().toISOString(),
  };
}

module.exports = {
  backfillBrand,
  fetchAllActiveProducts,
  normalizeProduct,
  shopifyGraphql,
};
