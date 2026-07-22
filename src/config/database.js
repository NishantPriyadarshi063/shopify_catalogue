'use strict';

const { Pool } = require('pg');
const config = require('./env');

const pool = new Pool({
  connectionString: config.database.connectionString,
  ssl: config.database.ssl,
  max: 10,
  options: `-c search_path=${config.database.schema},public`,
});

async function query(text, params = []) {
  return pool.query(text, params);
}

async function withClient(fn) {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

async function closePool() {
  await pool.end();
}

module.exports = {
  pool,
  query,
  withClient,
  closePool,
  schema: config.database.schema,
};
