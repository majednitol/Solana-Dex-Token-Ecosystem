'use strict';

const Redis = require('ioredis');

class CacheService {
  constructor() {
    this.client = null;
    this.subscriber = null;
    this.enabled = false;
  }

  async init() {
    const url = process.env.REDIS_URL;
    if (!url) {
      console.warn('[Cache] REDIS_URL not set — cache/pubsub disabled');
      return false;
    }
    try {
      this.client = new Redis(url, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => Math.min(times * 200, 5000),
        lazyConnect: true,
      });
      await this.client.connect();

      this.subscriber = new Redis(url, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => Math.min(times * 200, 5000),
        lazyConnect: true,
      });
      await this.subscriber.connect();

      this.enabled = true;
      console.log('[Cache] Redis connected');
      return true;
    } catch (e) {
      console.warn('[Cache] Redis connect failed:', e.message);
      this.enabled = false;
      return false;
    }
  }

  async get(key) {
    if (!this.enabled) return null;
    try {
      const val = await this.client.get(key);
      return val ? JSON.parse(val) : null;
    } catch { return null; }
  }

  async set(key, data, ttlSec = 5) {
    if (!this.enabled) return;
    try {
      await this.client.set(key, JSON.stringify(data), 'EX', ttlSec);
    } catch {}
  }

  async del(key) {
    if (!this.enabled) return;
    try { await this.client.del(key); } catch {}
  }

  async cacheCandles(tokenId, interval, data, ttlSec = 5) {
    return this.set(`candles:${tokenId}:${interval}`, data, ttlSec);
  }

  async getCachedCandles(tokenId, interval) {
    return this.get(`candles:${tokenId}:${interval}`);
  }

  async invalidateCandles(tokenId) {
    if (!this.enabled) return;
    try {
      const keys = await this.client.keys(`candles:${tokenId}:*`);
      if (keys.length > 0) await this.client.del(...keys);
      await this.del(`sparkline:${tokenId}`);
    } catch {}
  }

  async cacheSparkline(tokenId, hours, data, ttlSec = 5) {
    return this.set(`sparkline:${tokenId}:${hours}`, data, ttlSec);
  }

  async getCachedSparkline(tokenId, hours) {
    return this.get(`sparkline:${tokenId}:${hours}`);
  }

  async publish(channel, data) {
    if (!this.enabled) return;
    try {
      await this.client.publish(channel, JSON.stringify(data));
    } catch {}
  }

  subscribe(channel, callback) {
    if (!this.enabled) return null;
    if (!this._messageHandlerAttached) {
      this._handlers = {};
      this.subscriber.on('message', (ch, msg) => {
        const fns = this._handlers[ch];
        if (fns) {
          let parsed;
          try { parsed = JSON.parse(msg); } catch { return; }
          for (const fn of fns) {
            try { fn(parsed); } catch {}
          }
        }
      });
      this._messageHandlerAttached = true;
    }
    if (!this._handlers[channel]) this._handlers[channel] = [];
    this._handlers[channel].push(callback);
    this.subscriber.subscribe(channel);
    return () => {
      this._handlers[channel] = (this._handlers[channel] || []).filter(fn => fn !== callback);
      if (this._handlers[channel].length === 0) {
        delete this._handlers[channel];
        this.subscriber.unsubscribe(channel);
      }
    };
  }

  async cacheTreasuryBalances(data) {
    return this.set('treasury:balances', data, 5);
  }

  async getCachedTreasuryBalances() {
    return this.get('treasury:balances');
  }

  async invalidateTreasuryCache() {
    return this.del('treasury:balances');
  }

  async publishFeeEvent(event) {
    return this.publish('fees:collected', event);
  }

  async publishUpdate(channel, detail) {
    return this.publish(channel, { channel, detail, ts: Date.now() });
  }

  async publishTreasuryUpdate(detail) { return this.publishUpdate('treasury:update', detail); }
  async publishTokensUpdate(detail) { return this.publishUpdate('tokens:update', detail); }
  async publishPoolsUpdate(detail) { return this.publishUpdate('pools:update', detail); }
  async publishAdminUpdate(detail) { return this.publishUpdate('admin:update', detail); }
  async publishBalancesUpdate(detail) { return this.publishUpdate('balances:update', detail); }
  async publishPricesUpdate(detail) { return this.publishUpdate('prices:update', detail); }

  async shutdown() {
    try {
      if (this.subscriber) await this.subscriber.quit();
      if (this.client) await this.client.quit();
    } catch {}
    this.enabled = false;
  }
}

module.exports = { CacheService };
