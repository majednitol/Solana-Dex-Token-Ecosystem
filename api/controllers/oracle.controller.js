'use strict';

let roundCounter = 0;

function createOracleController(deps) {
  const { priceService, treasuryService } = deps;

  async function getLatestPrice(request) {
    const token = request.query.token || request.query.symbol;
    const pair = request.query.pair || undefined;
    if (!token) {
      return { success: false, message: 'Token is required', _status: 400 };
    }

    const latest = await priceService.getLatestPrice(token.toUpperCase(), pair ? pair.toUpperCase() : undefined);
    return { success: true, data: latest };
  }

  async function getPriceFeed(request) {
    const token = request.query.token || request.query.symbol;
    const pair = request.query.pair || undefined;
    if (!token) {
      return { success: false, message: 'Token is required', _status: 400 };
    }

    const latest = await priceService.getLatestPrice(token.toUpperCase(), pair ? pair.toUpperCase() : undefined);

    if (!latest) {
      return {
        success: true,
        data: {
          roundId: 0,
          answer: 0,
          startedAt: null,
          updatedAt: null,
          decimals: 5,
          token: token.toUpperCase(),
          description: `${token.toUpperCase()} / ${(pair || 'USD').toUpperCase()} Price Feed`,
        },
      };
    }

    roundCounter++;
    const updatedAt = new Date(latest.created_at);

    return {
      success: true,
      data: {
        roundId: roundCounter,
        answer: latest.price,
        startedAt: updatedAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
        decimals: 5,
        token: latest.token_symbol,
        pair: latest.pair_symbol || null,
        source: latest.source,
        description: `${latest.token_symbol} / ${latest.pair_symbol || 'USD'} Price Feed`,
      },
    };
  }

  async function getPriceHistory(request) {
    const token = request.query.token || request.query.symbol;
    if (!token) {
      return { success: false, message: 'Token is required', _status: 400 };
    }

    const limit = Math.min(Math.max(Number(request.query.limit) || 100, 1), 2000);
    const days = request.query.days;
    const pair = request.query.pair ? request.query.pair.toUpperCase() : undefined;

    let prices;
    if (days) {
      prices = await priceService.getHistoricalPrices(token.toUpperCase(), Number(days));
      if (prices.length > limit) prices = prices.slice(0, limit);
    } else {
      prices = await priceService.getHistoricalPricesFiltered({
        tokenSymbol: token.toUpperCase(),
        pairSymbol: pair,
        from: request.query.from,
        to: request.query.to,
        limit,
        offset: request.query.offset,
      });
    }

    return {
      success: true,
      data: {
        token: token.toUpperCase(),
        count: prices.length,
        prices,
      },
    };
  }

  async function getAveragePrice(request) {
    const token = request.query.token || request.query.symbol;
    if (!token) {
      return { success: false, message: 'Token is required', _status: 400 };
    }

    const avg = await priceService.get365DayAveragePrice(token.toUpperCase());

    return {
      success: true,
      data: {
        token: token.toUpperCase(),
        averagePrice: avg.vwap,
        period: '365d',
        dataPoints: avg.dataPoints,
        included: avg.included,
        filtered: avg.filtered,
        median: avg.median,
      },
    };
  }

  async function getVwap(request) {
    const token = request.query.token || request.query.symbol;
    if (!token) {
      return { success: false, message: 'Token is required', _status: 400 };
    }

    const pair = request.query.pair ? request.query.pair.toUpperCase() : undefined;
    const days = request.query.days || 365;

    const vwap = await priceService.getVwap({
      tokenSymbol: token.toUpperCase(),
      pairSymbol: pair,
      days,
    });

    return {
      success: true,
      data: {
        token: token.toUpperCase(),
        pair: pair || null,
        ...vwap,
      },
    };
  }

  async function getPriceStatus(request) {
    const token = request.query.token || request.query.symbol;
    if (!token) {
      return { success: false, message: 'Token is required', _status: 400 };
    }

    const latest = await priceService.getLatestPrice(token.toUpperCase());
    const avg = await priceService.get365DayAveragePrice(token.toUpperCase());

    if (!latest) {
      return {
        success: true,
        data: {
          token: token.toUpperCase(),
          isValid: false,
          reason: 'No price data available',
          lastUpdate: null,
          deviation: null,
          currentPrice: null,
          averagePrice: null,
        },
      };
    }

    const lastUpdate = new Date(latest.created_at);
    const ageMs = Date.now() - lastUpdate.getTime();
    const staleThresholdMs = 5 * 60 * 1000;
    const isStale = ageMs > staleThresholdMs;

    const currentPrice = latest.price;
    const averagePrice = avg.vwap || 0;
    const deviation = averagePrice > 0 ? ((currentPrice - averagePrice) / averagePrice) * 100 : 0;
    const isDeviated = Math.abs(deviation) > 30;

    const isValid = !isStale && !isDeviated && currentPrice > 0;

    return {
      success: true,
      data: {
        token: token.toUpperCase(),
        isValid,
        currentPrice,
        averagePrice,
        deviation: parseFloat(deviation.toFixed(2)),
        lastUpdate: lastUpdate.toISOString(),
        ageSeconds: Math.floor(ageMs / 1000),
        isStale,
        isDeviated,
        source: latest.source,
        dataPoints: avg.dataPoints,
      },
    };
  }

  async function getTreasuryValue(request) {
    const valuation = await treasuryService.getVaultValuation(priceService);
    return { success: true, data: valuation };
  }

  async function getPerformance(request) {
    const { metricsService } = deps;
    if (!metricsService) {
      return { success: false, message: 'Metrics not available', _status: 503 };
    }

    const report = metricsService.getPerformanceReport();

    const allTokens = await priceService.getLatestPrices();
    const oracleHealth = [];
    for (const p of (allTokens || [])) {
      const age = p.created_at ? Math.floor((Date.now() - new Date(p.created_at).getTime()) / 1000) : null;
      oracleHealth.push({
        token: p.token_symbol,
        pair: p.pair_symbol,
        source: p.source,
        price: p.price,
        ageSeconds: age,
        fresh: age !== null && age < 300,
      });
    }

    const freshCount = oracleHealth.filter(h => h.fresh).length;
    const totalFeeds = oracleHealth.length;

    return {
      success: true,
      data: {
        ...report,
        oracle: {
          totalFeeds,
          freshFeeds: freshCount,
          staleFeeds: totalFeeds - freshCount,
          freshnessRate: totalFeeds > 0 ? parseFloat(((freshCount / totalFeeds) * 100).toFixed(1)) : 0,
          feeds: oracleHealth,
        },
      },
    };
  }

  return {
    getLatestPrice,
    getPriceFeed,
    getPriceHistory,
    getAveragePrice,
    getVwap,
    getPriceStatus,
    getTreasuryValue,
    getPerformance,
  };
}

module.exports = { createOracleController };
