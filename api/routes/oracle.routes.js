'use strict';

const { createOracleController } = require('../controllers/oracle.controller');

function sendResult(reply, result, routeCache, cacheKey, ttlMs) {
  const status = result._status;
  if (status) {
    delete result._status;
    return reply.status(status).send(result);
  }
  if (cacheKey && ttlMs) {
    routeCache.set(cacheKey, result, ttlMs);
  }
  return reply.send(result);
}

function wrapHandler(fn) {
  return async (request, reply) => {
    try {
      return await fn(request, reply);
    } catch (e) {
      console.error('[Oracle Routes] Error:', e.message);
      return reply.status(500).send({ success: false, message: e.message });
    }
  };
}

function registerOracleRoutes(app, deps, routeCache) {
  const ctrl = createOracleController(deps);

  app.get('/oracle/price/latest', wrapHandler(async (request, reply) => {
    const token = request.query.token || request.query.symbol;
    const pair = request.query.pair || 'any';
    const cacheKey = `api:oracle:price:latest:${token}:${pair}`;
    const cached = routeCache.get(cacheKey);
    if (cached) return reply.send(cached);

    const result = await ctrl.getLatestPrice(request);
    return sendResult(reply, result, routeCache, cacheKey, 15000);
  }));

  app.get('/oracle/price/feed', wrapHandler(async (request, reply) => {
    const token = request.query.token || request.query.symbol;
    const pair = request.query.pair || 'any';
    const cacheKey = `api:oracle:price:feed:${token}:${pair}`;
    const cached = routeCache.get(cacheKey);
    if (cached) return reply.send(cached);

    const result = await ctrl.getPriceFeed(request);
    return sendResult(reply, result, routeCache, cacheKey, 15000);
  }));

  app.get('/oracle/price/history', wrapHandler(async (request, reply) => {
    const result = await ctrl.getPriceHistory(request);
    return sendResult(reply, result, routeCache, null, 0);
  }));

  app.get('/oracle/price/average', wrapHandler(async (request, reply) => {
    const token = request.query.token || request.query.symbol;
    const cacheKey = `api:oracle:price:average:${token}`;
    const cached = routeCache.get(cacheKey);
    if (cached) return reply.send(cached);

    const result = await ctrl.getAveragePrice(request);
    return sendResult(reply, result, routeCache, cacheKey, 60000);
  }));

  app.get('/oracle/price/vwap', wrapHandler(async (request, reply) => {
    const token = request.query.token || request.query.symbol;
    const pair = request.query.pair || 'any';
    const days = request.query.days || 365;
    const cacheKey = `api:oracle:price:vwap:${token}:${pair}:${days}`;
    const cached = routeCache.get(cacheKey);
    if (cached) return reply.send(cached);

    const result = await ctrl.getVwap(request);
    return sendResult(reply, result, routeCache, cacheKey, 60000);
  }));

  app.get('/oracle/price/status', wrapHandler(async (request, reply) => {
    const token = request.query.token || request.query.symbol;
    const cacheKey = `api:oracle:price:status:${token}`;
    const cached = routeCache.get(cacheKey);
    if (cached) return reply.send(cached);

    const result = await ctrl.getPriceStatus(request);
    return sendResult(reply, result, routeCache, cacheKey, 15000);
  }));

  app.get('/oracle/treasury/value', wrapHandler(async (request, reply) => {
    const cacheKey = 'api:oracle:treasury:value';
    const cached = routeCache.get(cacheKey);
    if (cached) return reply.send(cached);

    const result = await ctrl.getTreasuryValue(request);
    return sendResult(reply, result, routeCache, cacheKey, 30000);
  }));

  app.get('/oracle/performance', wrapHandler(async (request, reply) => {
    const result = await ctrl.getPerformance(request);
    return sendResult(reply, result, routeCache, null, 0);
  }));

  console.log('[Oracle Routes] Registered /oracle/* endpoints');
}

module.exports = { registerOracleRoutes };
