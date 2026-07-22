'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const config = require('../src/config/env');

async function migrate() {
  const pool = new Pool({
    connectionString: config.database.connectionString,
    ssl: config.database.ssl,
  });

  const sqlPath = path.join(__dirname, 'migrations', '001_catalogue_schema.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  console.log(`Migrating schema "${config.database.schema}"...`);
  await pool.query(sql);
  console.log('Migration complete.');
  await pool.end();
}

migrate().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
