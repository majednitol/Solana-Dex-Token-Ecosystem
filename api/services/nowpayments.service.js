'use strict';

const crypto = require('crypto');
const { loadSdk, verifySdkPatchable } = require('../lib/nowpayments-patched');

class NowPaymentsService {
  constructor({ apiKey, ipnSecret, priceService }) {
    this.apiKey = apiKey || '';
    this.ipnSecret = ipnSecret || '';
    this.priceService = priceService || null;
    this.isSandbox = process.env.NOWPAYMENTS_SANDBOX === 'true';

    if (this.isSandbox) verifySdkPatchable();
    const NowPaymentsApi = loadSdk(this.isSandbox);
    this.npApi = new NowPaymentsApi({ apiKey: this.apiKey });

    const mode = this.isSandbox ? 'SANDBOX' : 'PRODUCTION';
    const baseUrl = this.isSandbox
      ? 'https://api-sandbox.nowpayments.io/v1'
      : 'https://api.nowpayments.io/v1';
    console.log(`[NOWPayments] Mode: ${mode} | Base URL: ${baseUrl}`);
  }

  _assertSuccess(data, context) {
    if (!data || typeof data !== 'object') {
      throw new Error(`[NOWPayments] ${context}: empty or invalid response`);
    }
    if (data.statusCode >= 400 || data.code === 'NOT_FOUND' || data.code === 'FORBIDDEN') {
      const msg = data.message || data.error || `status ${data.statusCode}`;
      throw new Error(`[NOWPayments] ${context}: ${msg}`);
    }
    if (data.error) {
      throw new Error(`[NOWPayments] ${context}: ${data.error}`);
    }
    return data;
  }

  async getStatus() {
    const data = await this.npApi.status();
    return this._assertSuccess(data, 'getStatus');
  }

  async getCurrencies() {
    const data = await this.npApi.getCurrencies();
    this._assertSuccess(data, 'getCurrencies');
    if (!Array.isArray(data.currencies)) {
      throw new Error('[NOWPayments] getCurrencies: missing currencies array');
    }
    return data.currencies;
  }

  async getEstimate({ amountUsd, currencyFrom, currencyTo }) {
    const data = await this.npApi.getEstimatePrice({
      amount: parseFloat(amountUsd),
      currency_from: currencyFrom || 'usd',
      currency_to: currencyTo || 'btc',
    });
    this._assertSuccess(data, 'getEstimate');
    if (data.estimated_amount === undefined) {
      throw new Error('[NOWPayments] getEstimate: missing estimated_amount');
    }
    return data;
  }

  async getMinPaymentAmount(currencyFrom, currencyTo) {
    const data = await this.npApi.getMinimumPaymentAmount({
      currency_from: currencyFrom || 'btc',
      currency_to: currencyTo || 'usd',
    });
    this._assertSuccess(data, 'getMinPaymentAmount');
    if (data.min_amount === undefined) {
      throw new Error('[NOWPayments] getMinPaymentAmount: missing min_amount');
    }
    return data;
  }

  async createPayment({
    priceAmount,
    priceCurrency,
    payCurrency,
    orderId,
    orderDescription,
    ipnCallbackUrl,
  }) {
    const data = await this.npApi.createPayment({
      price_amount: priceAmount,
      price_currency: priceCurrency || 'usd',
      pay_currency: payCurrency,
      order_id: orderId,
      order_description: orderDescription || 'Buy NTC tokens',
      ipn_callback_url: ipnCallbackUrl,
    });
    this._assertSuccess(data, 'createPayment');
    if (!data.payment_id) {
      throw new Error('[NOWPayments] createPayment: missing payment_id in response');
    }
    return data;
  }

  async getPaymentStatus(paymentId) {
    const data = await this.npApi.getPaymentStatus({ payment_id: paymentId });
    this._assertSuccess(data, 'getPaymentStatus');
    if (!data.payment_status) {
      throw new Error('[NOWPayments] getPaymentStatus: missing payment_status');
    }
    return data;
  }

  verifyIpn(body, hmacHeader) {
    if (!this.ipnSecret || !hmacHeader) return false;

    const sorted = this._sortObject(body);
    const jsonStr = JSON.stringify(sorted);
    const hmac = crypto
      .createHmac('sha512', this.ipnSecret)
      .update(jsonStr)
      .digest('hex');

    return hmac === hmacHeader;
  }

  _sortObject(obj) {
    if (typeof obj !== 'object' || obj === null) return obj;
    if (Array.isArray(obj)) return obj.map(item => this._sortObject(item));
    const sorted = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = this._sortObject(obj[key]);
    }
    return sorted;
  }

  async getNtcPriceUsd(tokenSymbol) {
    const sym = (tokenSymbol || 'NTC').toUpperCase();
    const DEFAULT_PRICE_USD = 1.00;
    try {
      const db = require('../db/init');
      const adminRow = await db.query(
        'SELECT price_usd FROM token_buy_price_config WHERE token_symbol = $1',
        [sym]
      );
      if (adminRow.rows[0]?.price_usd > 0) return adminRow.rows[0].price_usd;
    } catch (_) {}
    return DEFAULT_PRICE_USD;
  }
}

module.exports = { NowPaymentsService };
