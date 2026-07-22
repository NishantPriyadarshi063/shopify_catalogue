-- Catalogue schema (shopify)
-- Run: node scripts/migrate.js

CREATE SCHEMA IF NOT EXISTS shopify;

CREATE TABLE IF NOT EXISTS shopify.brands (
  brand_id        INTEGER PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  shop_domain     TEXT NOT NULL,
  last_synced_at  TIMESTAMPTZ,
  product_count   INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shopify.catalogue_products (
  id                TEXT NOT NULL,                 -- gid://shopify/Product/...
  brand_id          INTEGER NOT NULL REFERENCES shopify.brands(brand_id) ON DELETE CASCADE,
  handle            TEXT NOT NULL,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  description_full  TEXT NOT NULL DEFAULT '',
  category          TEXT NOT NULL DEFAULT 'Uncategorized',
  product_type      TEXT NOT NULL DEFAULT '',
  tags              TEXT[] NOT NULL DEFAULT '{}',
  status            TEXT NOT NULL DEFAULT 'ACTIVE',
  image_url         TEXT NOT NULL DEFAULT '',
  images            JSONB NOT NULL DEFAULT '[]'::jsonb,
  price_min         NUMERIC(12,2) NOT NULL DEFAULT 0,
  price_max         NUMERIC(12,2) NOT NULL DEFAULT 0,
  compare_at        NUMERIC(12,2),
  sku               TEXT NOT NULL DEFAULT '',
  variant_count     INTEGER NOT NULL DEFAULT 0,
  inventory_total   INTEGER NOT NULL DEFAULT 0,
  shopify_updated_at TIMESTAMPTZ,
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (brand_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_catalogue_products_brand_handle
  ON shopify.catalogue_products (brand_id, handle);

CREATE INDEX IF NOT EXISTS idx_catalogue_products_brand_category
  ON shopify.catalogue_products (brand_id, category);

CREATE INDEX IF NOT EXISTS idx_catalogue_products_brand_status
  ON shopify.catalogue_products (brand_id, status);

CREATE TABLE IF NOT EXISTS shopify.catalogue_variants (
  id                    TEXT NOT NULL,             -- gid://shopify/ProductVariant/...
  brand_id              INTEGER NOT NULL,
  product_id            TEXT NOT NULL,
  sku                   TEXT NOT NULL DEFAULT '',
  title                 TEXT NOT NULL DEFAULT '',
  price                 NUMERIC(12,2) NOT NULL DEFAULT 0,
  compare_at_price      NUMERIC(12,2),
  inventory_quantity    INTEGER NOT NULL DEFAULT 0,
  inventory_item_id     TEXT,
  synced_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (brand_id, id),
  FOREIGN KEY (brand_id, product_id)
    REFERENCES shopify.catalogue_products (brand_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_catalogue_variants_product
  ON shopify.catalogue_variants (brand_id, product_id);

CREATE INDEX IF NOT EXISTS idx_catalogue_variants_sku
  ON shopify.catalogue_variants (brand_id, sku);
