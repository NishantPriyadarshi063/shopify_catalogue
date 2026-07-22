'use strict';

/**
 * Serial in-process job queue (concurrency 1).
 */
class CatalogueQueue {
  constructor(processor) {
    this.processor = processor;
    this.queue = [];
    this.running = false;
  }

  push(job) {
    this.queue.push(job);
    this._drain();
  }

  get size() {
    return this.queue.length;
  }

  async _drain() {
    if (this.running) return;
    this.running = true;
    while (this.queue.length) {
      const job = this.queue.shift();
      try {
        await this.processor(job);
      } catch (err) {
        console.error('[queue] job failed', job?.topic, err.message);
      }
    }
    this.running = false;
  }
}

module.exports = { CatalogueQueue };
