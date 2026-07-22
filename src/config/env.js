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

function parseBrandList(value) {
  if (!value || !String(value).trim()) return [];
  return String(value)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function envBool(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
}

const dbConfig = parseDatabaseUrl(process.env.DATABASE_URL);

module.exports = {
  port: Number(process.env.PORT || 5050),
  nodeEnv: process.env.NODE_ENV || 'development',
  apiVersion: process.env.SHOPIFY_API_VERSION || '2025-01',
  defaultBrand: process.env.CATALOGUE_DEFAULT_BRAND || 'tiltingheads',
  database: dbConfig,
  backfill: {
    enabled: envBool('CATALOGUE_BACKFILL_ENABLED', true),
    intervalMin: Number(process.env.CATALOGUE_BACKFILL_INTERVAL_MIN || 30),
    runOnBoot: envBool('CATALOGUE_BACKFILL_ON_BOOT', true),
    bootDelaySec: Number(process.env.CATALOGUE_BACKFILL_BOOT_DELAY_SEC || 10),
    // empty = all configured brands
    brands: parseBrandList(process.env.CATALOGUE_BACKFILL_BRANDS),
  },
};
