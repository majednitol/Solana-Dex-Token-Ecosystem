import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

const NTC_MINT = 'GqFz3riinXUmQittZFy2kKE7CF49WnAujJ6vKUpEL3fB';
const ASDC_MINT = '7mYrsR87Yfbr4qBqfHaAiawkTSG6DzduPdPk915pMqXd';

const errorRate = new Rate('errors');
const healthDuration = new Trend('health_duration', true);
const tokensDuration = new Trend('tokens_duration', true);
const poolsDuration = new Trend('pools_duration', true);
const quoteDuration = new Trend('quote_duration', true);
const candlesDuration = new Trend('candles_duration', true);
const tradesDuration = new Trend('trades_duration', true);
const oracleDuration = new Trend('oracle_duration', true);
const treasuryDuration = new Trend('treasury_duration', true);

export const options = {
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  stages: [
    { duration: '30s', target: 20 },
    { duration: '1m', target: 20 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    errors: ['rate<0.05'],
  },
};

export default function () {
  const params = { timeout: '10s' };

  {
    const res = http.get(`${BASE_URL}/health`, params);
    healthDuration.add(res.timings.duration);
    const ok = check(res, {
      'health: status 200': (r) => r.status === 200,
      'health: ok=true': (r) => {
        try { return JSON.parse(r.body).ok === true; } catch { return false; }
      },
    });
    errorRate.add(!ok);
  }

  {
    const res = http.get(`${BASE_URL}/tokens`, params);
    tokensDuration.add(res.timings.duration);
    const ok = check(res, {
      'tokens: status 200': (r) => r.status === 200,
      'tokens: has data': (r) => {
        try {
          const data = JSON.parse(r.body);
          return data.ok === true && Array.isArray(data.tokens);
        } catch { return false; }
      },
    });
    errorRate.add(!ok);
  }

  {
    const res = http.get(`${BASE_URL}/pools?tokenA=NTC&tokenB=ASDC`, params);
    poolsDuration.add(res.timings.duration);
    const ok = check(res, {
      'pools: status 200': (r) => r.status === 200,
    });
    errorRate.add(!ok);
  }

  {
    const res = http.get(`${BASE_URL}/quote?mintIn=${NTC_MINT}&mintOut=${ASDC_MINT}&amountIn=1000000`, params);
    quoteDuration.add(res.timings.duration);
    const ok = check(res, {
      'quote: status 200': (r) => r.status === 200,
    });
    errorRate.add(!ok);
  }

  {
    const res = http.get(`${BASE_URL}/chart/candles?tokenId=${NTC_MINT}&timeframe=1H`, params);
    candlesDuration.add(res.timings.duration);
    const ok = check(res, {
      'candles: status 200': (r) => r.status === 200,
    });
    errorRate.add(!ok);
  }

  {
    const res = http.get(`${BASE_URL}/chart/trades?tokenId=${NTC_MINT}`, params);
    tradesDuration.add(res.timings.duration);
    const ok = check(res, {
      'trades: status 200': (r) => r.status === 200,
    });
    errorRate.add(!ok);
  }

  {
    const res = http.get(`${BASE_URL}/oracle/prices`, params);
    oracleDuration.add(res.timings.duration);
    const ok = check(res, {
      'oracle: status 200': (r) => r.status === 200,
    });
    errorRate.add(!ok);
  }

  {
    const res = http.get(`${BASE_URL}/balances/treasury`, params);
    treasuryDuration.add(res.timings.duration);
    const ok = check(res, {
      'treasury: status 200': (r) => r.status === 200,
    });
    errorRate.add(!ok);
  }

  sleep(0.5);
}
