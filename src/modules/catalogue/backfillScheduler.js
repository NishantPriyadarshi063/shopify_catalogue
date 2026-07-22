'use strict';

const config = require('../../config/env');
const { getAllConfiguredBrands, getBrandBySlug } = require('../../config/brands');
const { backfillBrand } = require('./catalogueSync');

let running = false;
let timer = null;
let bootTimer = null;

const status = {
  enabled: false,
  intervalMin: 30,
  running: false,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastError: null,
  lastResults: [],
};

function resolveBrands() {
  const configured = getAllConfiguredBrands();
  const filter = config.backfill.brands;
  if (!filter.length) return configured;
  return filter
    .map((slug) => getBrandBySlug(slug))
    .filter(Boolean);
}

async function runScheduledBackfill(reason = 'cron') {
  if (running) {
    console.log(`[backfill-cron] skip (${reason}) — previous run still in progress`);
    return status;
  }

  const brands = resolveBrands();
  if (!brands.length) {
    console.warn('[backfill-cron] no brands configured — skipping');
    return status;
  }

  running = true;
  status.running = true;
  status.lastStartedAt = new Date().toISOString();
  status.lastError = null;

  console.log(
    `[backfill-cron] start (${reason}): ${brands.map((b) => b.slug).join(', ')}`,
  );

  const results = [];
  try {
    for (const brand of brands) {
      const meta = await backfillBrand(brand, {
        onProgress: ({ page, count }) => {
          process.stdout.write(`\r[backfill-cron] ${brand.slug} page ${page}, ${count}…`);
        },
      });
      process.stdout.write('\n');
      results.push(meta);
    }
    status.lastResults = results;
    console.log(`[backfill-cron] done (${reason}): ${results.length} brand(s)`);
  } catch (err) {
    status.lastError = err.message || String(err);
    console.error(`[backfill-cron] failed (${reason}):`, status.lastError);
  } finally {
    running = false;
    status.running = false;
    status.lastFinishedAt = new Date().toISOString();
  }

  return status;
}

function startBackfillScheduler() {
  status.enabled = config.backfill.enabled;
  status.intervalMin = config.backfill.intervalMin;

  if (!config.backfill.enabled) {
    console.log('[backfill-cron] disabled (CATALOGUE_BACKFILL_ENABLED=false)');
    return;
  }

  const intervalMs = Math.max(1, config.backfill.intervalMin) * 60 * 1000;
  const bootDelayMs = Math.max(0, config.backfill.bootDelaySec) * 1000;

  console.log(
    `[backfill-cron] enabled — every ${config.backfill.intervalMin} min`
    + (config.backfill.runOnBoot ? `, first run in ${config.backfill.bootDelaySec}s` : ''),
  );

  if (config.backfill.runOnBoot) {
    bootTimer = setTimeout(() => {
      runScheduledBackfill('boot').catch((err) => {
        console.error('[backfill-cron] boot run error:', err.message);
      });
    }, bootDelayMs);
    if (typeof bootTimer.unref === 'function') bootTimer.unref();
  }

  timer = setInterval(() => {
    runScheduledBackfill('interval').catch((err) => {
      console.error('[backfill-cron] interval run error:', err.message);
    });
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
}

function stopBackfillScheduler() {
  if (timer) clearInterval(timer);
  if (bootTimer) clearTimeout(bootTimer);
  timer = null;
  bootTimer = null;
}

function getBackfillStatus() {
  return { ...status, running };
}

module.exports = {
  startBackfillScheduler,
  stopBackfillScheduler,
  runScheduledBackfill,
  getBackfillStatus,
};
