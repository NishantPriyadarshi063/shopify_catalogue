'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const config = require('./config/env');
const { getAllConfiguredBrands } = require('./config/brands');
const { query, closePool } = require('./config/database');
const { createCatalogueRoutes } = require('./routes/catalogueRoutes');

async function main() {
  // Verify DB connectivity early
  await query('SELECT 1 AS ok');
  console.log(`Database connected (schema: ${config.database.schema})`);

  const brands = getAllConfiguredBrands();
  console.log(
    `Configured Shopify brands: ${brands.map((b) => `${b.slug}#${b.brandId}`).join(', ') || '(none)'}`,
  );

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/health', async (req, res) => {
    try {
      const { rows } = await query(
        `SELECT brand_id, slug, product_count, last_synced_at FROM brands ORDER BY brand_id`,
      );
      res.json({ ok: true, brands: rows });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.use('/api/v1/catalogue', createCatalogueRoutes());

  app.use(express.static(path.join(__dirname, '../public')));

  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  });

  const server = app.listen(config.port, () => {
    console.log(`Catalogue server listening on http://localhost:${config.port}`);
    console.log(`API: http://localhost:${config.port}/api/v1/catalogue/20/catalogue`);
    console.log(`UI:  http://localhost:${config.port}/`);
  });

  const shutdown = async () => {
    server.close();
    await closePool();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
