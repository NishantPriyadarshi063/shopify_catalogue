'use strict';

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const config = require('../../config/env');

class CatalogueStore {
  constructor(brand) {
    this.brand = brand;
    this.brandId = brand.brandId;
    this.slug = brand.slug;
    this.products = new Map();
    this.inventoryIndex = new Map(); // inventoryItem numeric/gid -> productId
    this.lastSyncAt = null;
    this.lastWebhookAt = null;
    this.snapshotPath = path.join(
      config.snapshotDir,
      `catalogue-snapshot-${brand.brandId}.json`,
    );
    this._saveTimer = null;
    this._etag = null;
  }

  upsert(product) {
    const existing = this.products.get(product.id);
    if (existing && new Date(product.updatedAt) < new Date(existing.updatedAt)) {
      return false;
    }

    if (existing) {
      for (const v of existing.variants || []) {
        if (v.inventoryItemId) this.inventoryIndex.delete(this._invKey(v.inventoryItemId));
      }
    }

    this.products.set(product.id, product);
    for (const v of product.variants || []) {
      if (v.inventoryItemId) {
        this.inventoryIndex.set(this._invKey(v.inventoryItemId), product.id);
      }
    }
    this._etag = null;
    return true;
  }

  remove(productId) {
    const existing = this.products.get(productId);
    if (existing) {
      for (const v of existing.variants || []) {
        if (v.inventoryItemId) this.inventoryIndex.delete(this._invKey(v.inventoryItemId));
      }
    }
    const deleted = this.products.delete(productId);
    if (deleted) this._etag = null;
    return deleted;
  }

  findByInventoryItemId(inventoryItemId) {
    const productId = this.inventoryIndex.get(this._invKey(inventoryItemId));
    return productId ? this.products.get(productId) || null : null;
  }

  _invKey(id) {
    const s = String(id);
    const m = s.match(/(\d+)$/);
    return m ? m[1] : s;
  }

  all() {
    return Array.from(this.products.values());
  }

  byHandle(handle) {
    return this.all().find((p) => p.handle === handle) || null;
  }

  byCategory() {
    const grouped = {};
    for (const p of this.products.values()) {
      const c = p.category || 'Uncategorized';
      (grouped[c] ||= []).push(p);
    }
    for (const list of Object.values(grouped)) {
      list.sort((a, b) => a.title.localeCompare(b.title));
    }
    return grouped;
  }

  get etag() {
    if (!this._etag) {
      const base = `${this.lastSyncAt || ''}:${this.products.size}`;
      this._etag = crypto.createHash('sha1').update(base).digest('hex');
    }
    return this._etag;
  }

  meta() {
    const products = this.all();
    const uncategorized = products.filter((p) => p.category === 'Uncategorized').length;
    const inStock = products.filter((p) => p.inventoryTotal > 0).length;
    return {
      brandId: this.brandId,
      slug: this.slug,
      shopDomain: this.brand.shopDomain,
      productCount: products.length,
      inStock,
      uncategorized,
      lastSyncAt: this.lastSyncAt,
      lastWebhookAt: this.lastWebhookAt,
      etag: this.etag,
    };
  }

  async saveSnapshot() {
    await fs.mkdir(path.dirname(this.snapshotPath), { recursive: true });
    const payload = {
      brandId: this.brandId,
      slug: this.slug,
      lastSyncAt: this.lastSyncAt,
      savedAt: new Date().toISOString(),
      products: this.all(),
    };
    const tmp = `${this.snapshotPath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(payload));
    await fs.rename(tmp, this.snapshotPath);
  }

  saveSnapshotDebounced(ms = 10000) {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this.saveSnapshot().catch((err) => {
        console.error('[catalogue] snapshot save failed', err.message);
      });
    }, ms);
  }

  async loadSnapshot() {
    try {
      const raw = JSON.parse(await fs.readFile(this.snapshotPath, 'utf8'));
      this.products.clear();
      this.inventoryIndex.clear();
      for (const p of raw.products || []) {
        this.upsert(p);
      }
      this.lastSyncAt = raw.lastSyncAt || null;
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = { CatalogueStore };
