'use strict';

class MetricsService {
  constructor() {
    this.startTime = Date.now();
    this.requestCounts = {};
    this.responseTimes = {};
    this.statusCodes = {};
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.errors = [];
    this.maxErrors = 50;
    this.maxSamples = 200;
  }

  recordRequest(route, method, statusCode, durationMs) {
    const normalizedRoute = statusCode === 404 ? '/unknown' : route;
    const key = `${method} ${normalizedRoute}`;

    if (Object.keys(this.requestCounts).length > 500 && !this.requestCounts[key]) return;

    if (!this.requestCounts[key]) this.requestCounts[key] = 0;
    this.requestCounts[key]++;

    if (!this.responseTimes[key]) this.responseTimes[key] = [];
    this.responseTimes[key].push(durationMs);
    if (this.responseTimes[key].length > this.maxSamples) {
      this.responseTimes[key] = this.responseTimes[key].slice(-this.maxSamples);
    }

    const codeGroup = `${Math.floor(statusCode / 100)}xx`;
    if (!this.statusCodes[codeGroup]) this.statusCodes[codeGroup] = 0;
    this.statusCodes[codeGroup]++;

    if (statusCode >= 400) {
      this.errors.push({
        route: key,
        status: statusCode,
        time: new Date().toISOString(),
      });
      if (this.errors.length > this.maxErrors) {
        this.errors = this.errors.slice(-this.maxErrors);
      }
    }
  }

  recordCacheHit() { this.cacheHits++; }
  recordCacheMiss() { this.cacheMisses++; }

  getStats(route) {
    const times = this.responseTimes[route];
    if (!times || times.length === 0) return { avg: 0, min: 0, max: 0, p95: 0, count: 0 };

    const sorted = [...times].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    const p95Idx = Math.floor(sorted.length * 0.95);

    return {
      avg: parseFloat((sum / sorted.length).toFixed(2)),
      min: parseFloat(sorted[0].toFixed(2)),
      max: parseFloat(sorted[sorted.length - 1].toFixed(2)),
      p95: parseFloat(sorted[Math.min(p95Idx, sorted.length - 1)].toFixed(2)),
      count: this.requestCounts[route] || 0,
    };
  }

  getPerformanceReport() {
    const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);
    const totalRequests = Object.values(this.requestCounts).reduce((a, b) => a + b, 0);

    const endpoints = [];
    for (const route of Object.keys(this.requestCounts)) {
      endpoints.push({
        route,
        ...this.getStats(route),
      });
    }
    endpoints.sort((a, b) => b.count - a.count);

    const topSlowest = endpoints
      .filter(e => e.count >= 2)
      .sort((a, b) => b.p95 - a.p95)
      .slice(0, 10);

    const topBusiest = endpoints.slice(0, 10);

    const cacheTotal = this.cacheHits + this.cacheMisses;
    const cacheHitRate = cacheTotal > 0 ? parseFloat(((this.cacheHits / cacheTotal) * 100).toFixed(1)) : 0;

    const mem = process.memoryUsage();

    return {
      uptime: {
        seconds: uptimeSeconds,
        formatted: formatUptime(uptimeSeconds),
        startedAt: new Date(this.startTime).toISOString(),
      },
      requests: {
        total: totalRequests,
        perMinute: uptimeSeconds > 0 ? parseFloat((totalRequests / (uptimeSeconds / 60)).toFixed(2)) : 0,
        statusCodes: { ...this.statusCodes },
        errorRate: totalRequests > 0 ? parseFloat((((this.statusCodes['4xx'] || 0) + (this.statusCodes['5xx'] || 0)) / totalRequests * 100).toFixed(2)) : 0,
      },
      cache: {
        hits: this.cacheHits,
        misses: this.cacheMisses,
        hitRate: cacheHitRate,
        total: cacheTotal,
      },
      memory: {
        rss: formatBytes(mem.rss),
        heapUsed: formatBytes(mem.heapUsed),
        heapTotal: formatBytes(mem.heapTotal),
        external: formatBytes(mem.external),
        rssRaw: mem.rss,
        heapUsedRaw: mem.heapUsed,
        heapTotalRaw: mem.heapTotal,
      },
      endpoints: {
        total: endpoints.length,
        topBusiest,
        topSlowest,
      },
      recentErrors: this.errors.slice(-10),
    };
  }
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

module.exports = { MetricsService };
