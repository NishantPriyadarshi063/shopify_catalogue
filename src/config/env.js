'use strict';

require('dotenv').config();

function parseDatabaseUrl(url) {
  if (!url) {
    throw new Error('DATABASE_URL is required');
  }

  const parsed = new URL(url);
  const schema = parsed.searchParams.get('schema') || 'shopify';
  const sslMode = parsed.searchParams.get('sslmode');

  parsed.searchParams.delete('schema');
  parsed.searchParams.delete('sslmode');

  const connectionString = parsed.toString();
  const useSsl = sslMode === 'require' || sslMode === 'verify-full' || sslMode === 'prefer';

  return {
    connectionString,
    schema,
    ssl: useSsl ? { rejectUnauthorized: false } : false,
  };
}

const dbConfig = parseDatabaseUrl(process.env.DATABASE_URL);

module.exports = {
  port: Number(process.env.PORT || 5050),
  nodeEnv: process.env.NODE_ENV || 'development',
  apiVersion: process.env.SHOPIFY_API_VERSION || '2025-01',
  defaultBrand: process.env.CATALOGUE_DEFAULT_BRAND || 'tiltingheads',
  reconcileIntervalMin: Number(process.env.CATALOGUE_RECONCILE_INTERVAL_MIN || 60),
  database: dbConfig,
};
