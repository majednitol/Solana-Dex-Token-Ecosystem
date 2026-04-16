
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useTokenList } from "../stores/useTokenListStore";
import { useCurrency } from "../stores/useCurrencyStore";
import { TokenBadge } from "../components/TokenModal";
import { useLanguage } from "../stores/useLanguageStore";
import { useTokenPrice } from "../stores/useTokenPriceStore";
import useMoonPay from "../hooks/useMoonPay";
import useCryptoWallet, { getCurrencyType } from "../hooks/useCryptoWallet";
import { CreditCard, Coins } from "lucide-react";
import { explorerTxUrl } from "../utils/solanaExplorer";

const PAYMENT_METHODS_DATA = [
  {
    id: "moonpay",
    nameKey: "buy_method_moonpay",
    descKey: "buy_method_moonpay_desc",
    icon: <CreditCard size={18} />,
    tagKey: "buy_tag_fiat",
  },
  {
    id: "crypto",
    nameKey: "buy_method_crypto",
    descKey: "buy_method_crypto_desc",
    icon: <Coins size={18} />,
    tagKey: "buy_tag_crypto",
  },
];

const POPULAR_CURRENCIES = [
  "btc",
  "eth",
  "usdt",
  "usdc",
  "sol",
  "ltc",
  "trx",
  "doge",
  "bnb",
  "matic",
  "usdterc20",
  "usdcerc20",
  "avax",
  "usdtbsc",
  "usdcbsc",
];

function formatTimeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function getStatusColor(status) {
  if (
    status === "widget_opened" ||
    status === "pending" ||
    status === "waiting"
  )
    return "#f0ad4e";
  if (status === "widget_closed") return "#5bc0de";
  if (status === "confirming" || status === "sending") return "#5bc0de";
  if (status === "confirmed") return "#17a2b8";
  if (status === "completed" || status === "finished") return "#00d4aa";
  if (status === "failed" || status === "expired" || status === "send_failed")
    return "#d9534f";
  if (status === "underpaid") return "#e67e22";
  return "#888";
}

function BuyTokens() {
  const { connected, publicKey } = useWallet();
  const { formatPrice, currency } = useCurrency();
  const { t } = useLanguage();
  const { getTokenPrice, hasRealPrice } = useTokenPrice();
  const { tokens: allTokens } = useTokenList();
  const {
    openWidget,
    openSellWidget,
    loading: moonpayLoading,
    transactions,
    error: moonpayError,
    hasApiKey,
    fetchTransactions,
    onchainStep,
  } = useMoonPay();
  const cryptoWallet = useCryptoWallet();
  const [selectedToken, setSelectedToken] = useState(allTokens[0]);
  const [paymentMethod, setPaymentMethod] = useState("moonpay");
  const [amount, setAmount] = useState("");
  const [showTokenList, setShowTokenList] = useState(false);
  const [step, setStep] = useState("form");
  const [mode, setMode] = useState("buy");

  const [cryptoCurrencies, setCryptoCurrencies] = useState([]);
  const [selectedCryptoCurrency, setSelectedCryptoCurrency] = useState("eth");
  const [cryptoEstimate, setCryptoEstimate] = useState(null);
  const [estimateLoading, setEstimateLoading] = useState(false);
  const [cryptoPayment, setCryptoPayment] = useState(null);
  const [paymentStatus, setPaymentStatus] = useState(null);
  const [cryptoError, setCryptoError] = useState("");
  const [cryptoLoading, setCryptoLoading] = useState(false);
  const [cryptoPurchases, setCryptoPurchases] = useState([]);
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);
  const [currencySearch, setCurrencySearch] = useState("");
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [walletBalanceInfo, setWalletBalanceInfo] = useState(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [addressCopied, setAddressCopied] = useState(false);
  const pollRef = useRef(null);

  const TERMINAL_STATUSES = [
    "completed",
    "finished",
    "failed",
    "send_failed",
    "expired",
    "refunded",
  ];
  const isPaymentLocked =
    step === "crypto-pay" &&
    (cryptoWallet.sending ||
      cryptoWallet.txHash ||
      (paymentStatus &&
        !TERMINAL_STATUSES.includes(paymentStatus.status) &&
        paymentStatus.status !== "pending"));

  const [cryptoReceiveToken, setCryptoReceiveToken] = useState(() => {
    return (
      allTokens.find((t) => t.symbol?.toUpperCase() === "NTC") || allTokens[0]
    );
  });
  const activeToken =
    paymentMethod === "crypto" ? cryptoReceiveToken : selectedToken;
  const tokenCost =
    amount && activeToken
      ? parseFloat(amount) * (getTokenPrice(activeToken.id) || 1)
      : 0;
  const selectedPayment = PAYMENT_METHODS_DATA.find(
    (p) => p.id === paymentMethod,
  );

  useEffect(() => {
    fetch("/api/buy/currencies")
      .then((r) => r.json())
      .then((d) => {
        if (d.ok && d.currencies) setCryptoCurrencies(d.currencies);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (connected && publicKey) {
      fetch(`/api/buy/purchases/${publicKey.toBase58()}`)
        .then((r) => r.json())
        .then((d) => {
          if (d.ok) setCryptoPurchases(d.purchases || []);
        })
        .catch(() => {});
    }
  }, [connected, publicKey]);

  const MIN_DOLLAR_AMOUNT = 1;

  const fetchEstimate = useCallback(async () => {
    if (!amount || parseFloat(amount) <= 0 || paymentMethod !== "crypto")
      return;
    if (parseFloat(amount) < MIN_DOLLAR_AMOUNT) {
      setCryptoError(`Minimum purchase is $${MIN_DOLLAR_AMOUNT} USD`);
      setCryptoEstimate(null);
      return;
    }
    setEstimateLoading(true);
    setCryptoError("");
    try {
      const tokenSym = cryptoReceiveToken?.symbol?.toUpperCase() || "NTC";
      const res = await fetch(
        `/api/buy/estimate?dollarAmount=${encodeURIComponent(amount)}&payCurrency=${selectedCryptoCurrency}&tokenSymbol=${tokenSym}`,
      );
      const d = await res.json();
      if (d.ok) {
        setCryptoEstimate(d);
      } else {
        setCryptoError(d.error || "Failed to get estimate");
        setCryptoEstimate(null);
      }
    } catch {
      setCryptoError("Failed to get estimate");
      setCryptoEstimate(null);
    }
    setEstimateLoading(false);
  }, [amount, selectedCryptoCurrency, paymentMethod, cryptoReceiveToken]);

  useEffect(() => {
    if (paymentMethod === "crypto" && amount && parseFloat(amount) > 0) {
      const timer = setTimeout(fetchEstimate, 500);
      return () => clearTimeout(timer);
    } else {
      setCryptoEstimate(null);
    }
  }, [
    amount,
    selectedCryptoCurrency,
    paymentMethod,
    fetchEstimate,
    cryptoReceiveToken,
  ]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const pollPaymentStatus = useCallback((purchaseId) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/buy/payment-status/${purchaseId}`);
        const d = await res.json();
        if (d.ok && d.purchase) {
          setPaymentStatus(d.purchase);
          const st = d.purchase.status;
          const hasTxSig = !!d.purchase.ntc_tx_signature;
          if (
            st === "failed" ||
            st === "send_failed" ||
            st === "expired" ||
            st === "refunded"
          ) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          } else if ((st === "completed" || st === "finished") && hasTxSig) {
            clearInterval(pollRef.current);
            pollRef.current = null;
            setStep("success");
          }
        }
      } catch {}
    }, 5000);
  }, []);

  const handleCryptoPayment = async () => {
    if (!connected || !publicKey || !amount || parseFloat(amount) <= 0) return;
    if (parseFloat(amount) < MIN_DOLLAR_AMOUNT) {
      setCryptoError(`Minimum purchase is $${MIN_DOLLAR_AMOUNT} USD`);
      return;
    }
    setSubmitted(true);
    setCryptoLoading(true);
    setCryptoError("");
    try {
      const res = await fetch("/api/buy/create-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: publicKey.toBase58(),
          dollarAmount: parseFloat(amount),
          payCurrency: selectedCryptoCurrency,
          tokenSymbol: cryptoReceiveToken?.symbol?.toUpperCase() || "NTC",
        }),
      });
      const d = await res.json();
      if (d.ok) {
        setCryptoPayment(d);
        setStep("crypto-pay");
        pollPaymentStatus(d.purchaseId);
      } else {
        setCryptoError(d.error || "Failed to create payment");
        setSubmitted(false);
      }
    } catch (e) {
      setCryptoError("Failed to create payment");
      setSubmitted(false);
    }
    setCryptoLoading(false);
  };

  useEffect(() => {
    if (step === "crypto-pay" && cryptoWallet.walletAddress && cryptoPayment) {
      setBalanceLoading(true);
      cryptoWallet
        .getBalanceAndGas(
          cryptoPayment.payCurrency,
          cryptoPayment.payAddress,
          cryptoPayment.payAmount,
        )
        .then((info) => {
          setWalletBalanceInfo(info);
          setBalanceLoading(false);
        })
        .catch(() => setBalanceLoading(false));
    } else {
      setWalletBalanceInfo(null);
    }
  }, [step, cryptoWallet.walletAddress, cryptoPayment]);

  const getFee = () => {
    if (paymentMethod === "moonpay") return tokenCost * 0.035;
    return 0;
  };

  const handlePurchase = () => {
    if (!amount || parseFloat(amount) <= 0) return;
    if (paymentMethod === "moonpay") {
      let completed = false;
      const currentPrice = getTokenPrice(selectedToken.id) || 0;
      const widgetFn = mode === "sell" ? openSellWidget : openWidget;
      const params =
        mode === "sell"
          ? {
              cryptoCurrency: selectedToken.symbol.toLowerCase(),
              fiatCurrency: currency.code.toLowerCase(),
              cryptoAmount: amount,
              tokenPrice: currentPrice,
              tokenId: selectedToken.id,
              onComplete: () => {
                completed = true;
                setStep("success");
              },
              onClose: () => {
                if (!completed) setStep("form");
              },
            }
          : {
              cryptoCurrency: selectedToken.symbol.toLowerCase(),
              fiatCurrency: currency.code.toLowerCase(),
              fiatAmount: tokenCost.toFixed(2),
              tokenPrice: currentPrice,
              tokenId: selectedToken.id,
              onComplete: () => {
                completed = true;
                setStep("success");
              },
              onClose: () => {
                if (!completed) setStep("form");
              },
            };
      widgetFn(params).then((opened) => {
        if (opened) setStep("processing");
      });
      return;
    }
    if (paymentMethod === "crypto") {
      handleCryptoPayment();
      return;
    }
  };

  const handleReset = () => {
    setStep("form");
    setAmount("");
    setCryptoPayment(null);
    setPaymentStatus(null);
    setCryptoEstimate(null);
    setCryptoError("");
    setShowConfirmDialog(false);
    setSubmitted(false);
    cryptoWallet.resetState();
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (connected && publicKey) {
      fetch(`/api/buy/purchases/${publicKey.toBase58()}`)
        .then((r) => r.json())
        .then((d) => {
          if (d.ok) setCryptoPurchases(d.purchases || []);
        })
        .catch(() => {});
    }
  };

  const sellEstimateFiat =
    mode === "sell" && amount && selectedToken
      ? parseFloat(amount) * (getTokenPrice(selectedToken.id) || 1) * 0.965
      : 0;

  const filteredCurrencies = cryptoCurrencies.filter((c) =>
    c.toLowerCase().includes(currencySearch.toLowerCase()),
  );

  const sortedCurrencies = [
    ...POPULAR_CURRENCIES.filter((c) => filteredCurrencies.includes(c)),
    ...filteredCurrencies.filter((c) => !POPULAR_CURRENCIES.includes(c)),
  ];

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>
          {mode === "sell"
            ? t("sell_title") || "Sell Crypto"
            : t("sidebar_buy_tokens")}
        </h1>
        <p>
          {mode === "sell"
            ? t("sell_desc") || "Sell your crypto for fiat via MoonPay"
            : t("buy_desc")}
        </p>
      </div>

      <div className="buy-tokens-layout">
        <div className="buy-tokens-card">
          <div
            className="buy-sell-tabs"
            style={{
              display: "flex",
              gap: 0,
              marginBottom: 20,
              borderRadius: 10,
              overflow: "hidden",
              border: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            <button
              disabled={isPaymentLocked}
              onClick={() => {
                setMode("buy");
                setStep("form");
                setAmount("");
                setCryptoPayment(null);
                setPaymentStatus(null);
              }}
              style={{
                flex: 1,
                padding: "10px 0",
                background:
                  mode === "buy" ? "rgba(0,212,170,0.15)" : "transparent",
                color: mode === "buy" ? "#00d4aa" : "#888",
                border: "none",
                cursor: isPaymentLocked ? "not-allowed" : "pointer",
                fontWeight: 600,
                fontSize: 14,
                transition: "all 0.2s",
                opacity: isPaymentLocked ? 0.5 : 1,
              }}
            >
              {t("exch_buy")}
            </button>
            <button
              disabled={isPaymentLocked}
              onClick={() => {
                setMode("sell");
                setStep("form");
                setAmount("");
                setPaymentMethod("moonpay");
              }}
              style={{
                flex: 1,
                padding: "10px 0",
                background:
                  mode === "sell" ? "rgba(255,107,107,0.15)" : "transparent",
                color: mode === "sell" ? "#ff6b6b" : "#888",
                border: "none",
                cursor: isPaymentLocked ? "not-allowed" : "pointer",
                fontWeight: 600,
                fontSize: 14,
                transition: "all 0.2s",
                opacity: isPaymentLocked ? 0.5 : 1,
              }}
            >
              {t("exch_sell")}
            </button>
          </div>

          {(moonpayError || cryptoError) && (
            <div
              className="buy-error-banner"
              style={{
                padding: "10px 14px",
                background: "rgba(217,83,79,0.15)",
                border: "1px solid rgba(217,83,79,0.3)",
                borderRadius: 8,
                marginBottom: 16,
                color: "#d9534f",
                fontSize: 13,
              }}
            >
              {moonpayError || cryptoError}
            </div>
          )}

          {step === "form" && (
            <>
              <div className="buy-section">
                <label className="buy-label">{t("exch_select_token")}</label>
                {paymentMethod === "crypto" ? (
                  <>
                    <div
                      className="buy-token-selector"
                      onClick={() => setShowTokenList(!showTokenList)}
                    >
                      <div className="buy-token-selected">
                        <TokenBadge
                          token={cryptoReceiveToken || allTokens[0]}
                        />
                        <div>
                          <div className="buy-token-name">
                            {(cryptoReceiveToken || allTokens[0]).symbol}
                          </div>
                          <div className="buy-token-full">
                            {(cryptoReceiveToken || allTokens[0]).fullName}
                          </div>
                        </div>
                      </div>
                      <span className="chevron">▾</span>
                    </div>
                    {showTokenList && (
                      <div className="buy-token-dropdown">
                        {allTokens.map((token) => (
                          <div
                            key={token.id}
                            className={`buy-token-option ${cryptoReceiveToken?.id === token.id ? "selected" : ""}`}
                            onClick={() => {
                              setCryptoReceiveToken(token);
                              setShowTokenList(false);
                            }}
                          >
                            <TokenBadge token={token} />
                            <div>
                              <span className="buy-token-name">
                                {token.symbol}
                              </span>
                              <span className="buy-token-price">
                                {hasRealPrice(token.id)
                                  ? formatPrice(getTokenPrice(token.id))
                                  : "--"}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div
                      className="buy-token-selector"
                      onClick={() => setShowTokenList(!showTokenList)}
                    >
                      <div className="buy-token-selected">
                        <TokenBadge token={selectedToken} />
                        <div>
                          <div className="buy-token-name">
                            {selectedToken.symbol}
                          </div>
                          <div className="buy-token-full">
                            {selectedToken.fullName}
                          </div>
                        </div>
                      </div>
                      <span className="chevron">▾</span>
                    </div>

                    {showTokenList && (
                      <div className="buy-token-dropdown">
                        {allTokens.map((token) => (
                          <div
                            key={token.id}
                            className={`buy-token-option ${selectedToken.id === token.id ? "selected" : ""}`}
                            onClick={() => {
                              setSelectedToken(token);
                              setShowTokenList(false);
                            }}
                          >
                            <TokenBadge token={token} />
                            <div>
                              <span className="buy-token-name">
                                {token.symbol}
                              </span>
                              <span className="buy-token-price">
                                {hasRealPrice(token.id)
                                  ? formatPrice(getTokenPrice(token.id))
                                  : "--"}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="buy-section">
                <label className="buy-label">
                  {mode === "sell"
                    ? t("sell_amount") || "Amount to Sell"
                    : paymentMethod === "crypto"
                      ? "Amount in USD"
                      : t("exch_amount")}
                </label>
                <div className="buy-amount-input">
                  <input
                    type="number"
                    placeholder={paymentMethod === "crypto" ? "10.00" : "0.00"}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    min="0"
                    step={paymentMethod === "crypto" ? "1" : "0.01"}
                  />
                  <span className="buy-amount-symbol">
                    {mode === "buy" && paymentMethod === "crypto"
                      ? "USD"
                      : activeToken.symbol}
                  </span>
                </div>
                {mode === "buy" &&
                  paymentMethod === "crypto" &&
                  amount &&
                  parseFloat(amount) > 0 &&
                  parseFloat(amount) < MIN_DOLLAR_AMOUNT && (
                    <div
                      className="buy-amount-estimate"
                      style={{ color: "#ff6b6b" }}
                    >
                      Minimum purchase is ${MIN_DOLLAR_AMOUNT} USD
                    </div>
                  )}
                {mode === "buy" &&
                  paymentMethod === "crypto" &&
                  cryptoEstimate && (
                    <div className="buy-amount-estimate">
                      You receive: ~
                      {cryptoEstimate.ntcAmount?.toLocaleString(undefined, {
                        maximumFractionDigits: 4,
                      })}{" "}
                      {cryptoEstimate.tokenSymbol ||
                        activeToken?.symbol ||
                        "NTC"}{" "}
                      | Pay: {cryptoEstimate.estimatedPayAmount}{" "}
                      {selectedCryptoCurrency.toUpperCase()}
                    </div>
                  )}
                {mode === "buy" &&
                  paymentMethod === "crypto" &&
                  estimateLoading && (
                    <div
                      className="buy-amount-estimate"
                      style={{ color: "#888" }}
                    >
                      Calculating estimate...
                    </div>
                  )}
                {mode === "buy" &&
                  paymentMethod === "moonpay" &&
                  tokenCost > 0 && (
                    <div className="buy-amount-estimate">
                      {t("buy_estimated_cost")}: {formatPrice(tokenCost)}
                    </div>
                  )}
                {mode === "sell" && sellEstimateFiat > 0 && (
                  <div className="buy-amount-estimate">
                    {t("sell_estimated_payout") || "Estimated payout"}:{" "}
                    {formatPrice(sellEstimateFiat)}
                  </div>
                )}
              </div>

              {mode === "buy" && (
                <div className="buy-section">
                  <label className="buy-label">{t("buy_pay_with")}</label>
                  <div className="buy-payment-methods">
                    {PAYMENT_METHODS_DATA.map((method) => (
                      <div
                        key={method.id}
                        className={`buy-payment-option ${paymentMethod === method.id ? "active" : ""}`}
                        onClick={() => setPaymentMethod(method.id)}
                      >
                        <div className="buy-payment-header">
                          <span className="buy-payment-icon">
                            {method.icon}
                          </span>
                          <span className="buy-payment-name">
                            {t(method.nameKey) || method.nameKey}
                          </span>
                          <span
                            className={`buy-payment-tag ${(t(method.tagKey) || "crypto").toLowerCase()}`}
                          >
                            {t(method.tagKey) || "Crypto"}
                          </span>
                        </div>
                        <div className="buy-payment-desc">
                          {t(method.descKey) || method.descKey}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {mode === "buy" && paymentMethod === "crypto" && (
                <div className="buy-section">
                  <label className="buy-label">Pay with Currency</label>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 14px",
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 10,
                      cursor: "pointer",
                    }}
                    onClick={() => setShowCurrencyPicker(!showCurrencyPicker)}
                  >
                    <span
                      style={{
                        fontSize: 16,
                        fontWeight: 600,
                        textTransform: "uppercase",
                        color: "#fff",
                      }}
                    >
                      {selectedCryptoCurrency}
                    </span>
                    <span style={{ color: "#888", fontSize: 13, flex: 1 }}>
                      {selectedCryptoCurrency.toUpperCase()}
                    </span>
                    <span className="chevron">▾</span>
                  </div>
                  {showCurrencyPicker && (
                    <div
                      style={{
                        maxHeight: 260,
                        overflowY: "auto",
                        background: "#1a1a2e",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: 10,
                        marginTop: 6,
                        padding: 8,
                      }}
                    >
                      <input
                        type="text"
                        placeholder="Search currency..."
                        value={currencySearch}
                        onChange={(e) => setCurrencySearch(e.target.value)}
                        style={{
                          width: "100%",
                          padding: "8px 10px",
                          background: "rgba(255,255,255,0.06)",
                          border: "1px solid rgba(255,255,255,0.1)",
                          borderRadius: 8,
                          color: "#fff",
                          fontSize: 13,
                          marginBottom: 6,
                          outline: "none",
                          boxSizing: "border-box",
                        }}
                      />
                      {sortedCurrencies.map((c) => (
                        <div
                          key={c}
                          onClick={() => {
                            setSelectedCryptoCurrency(c);
                            setShowCurrencyPicker(false);
                            setCurrencySearch("");
                          }}
                          style={{
                            padding: "8px 10px",
                            cursor: "pointer",
                            borderRadius: 6,
                            fontSize: 13,
                            textTransform: "uppercase",
                            fontWeight:
                              selectedCryptoCurrency === c ? 600 : 400,
                            color:
                              selectedCryptoCurrency === c ? "#00d4aa" : "#ccc",
                            background:
                              selectedCryptoCurrency === c
                                ? "rgba(0,212,170,0.1)"
                                : "transparent",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                          }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.background =
                              "rgba(255,255,255,0.06)")
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.background =
                              selectedCryptoCurrency === c
                                ? "rgba(0,212,170,0.1)"
                                : "transparent")
                          }
                        >
                          <span>{c.toUpperCase()}</span>
                          <span
                            style={{
                              fontSize: 9,
                              color: "#00d4aa",
                              opacity: 0.7,
                              textTransform: "none",
                            }}
                          >
                            {(() => {
                              const t = getCurrencyType(c);
                              return t === "evm"
                                ? "EVM"
                                : t === "solana"
                                  ? "Solana"
                                  : "Wallet";
                            })()}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {mode === "buy" &&
                paymentMethod === "crypto" &&
                import.meta.env.VITE_NOWPAYMENTS_SANDBOX === "true" && (
                  <div
                    style={{
                      padding: "8px 12px",
                      background: "rgba(240,173,78,0.1)",
                      border: "1px solid rgba(240,173,78,0.25)",
                      borderRadius: 8,
                      fontSize: 11,
                      color: "#f0ad4e",
                      marginBottom: 8,
                    }}
                  >
                    Testnet / Sandbox mode active — wallets will use test chains
                    (Sepolia, BSC Testnet, etc.)
                  </div>
                )}

              {mode === "sell" && (
                <div className="buy-section">
                  <label className="buy-label">
                    {t("sell_receive_via") || "Receive via"}
                  </label>
                  <div className="buy-payment-methods">
                    <div className="buy-payment-option active">
                      <div className="buy-payment-header">
                        <span className="buy-payment-icon">
                          <CreditCard size={18} />
                        </span>
                        <span className="buy-payment-name">MoonPay</span>
                        <span className="buy-payment-tag fiat">
                          {t("buy_tag_fiat")}
                        </span>
                      </div>
                      <div className="buy-payment-desc">
                        {t("sell_method_moonpay_desc") ||
                          "Receive fiat to your bank account"}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {mode === "buy" &&
                paymentMethod === "moonpay" &&
                tokenCost > 0 && (
                  <div className="buy-summary">
                    <div className="buy-summary-row">
                      <span>{t("buy_you_receive")}</span>
                      <span>
                        {parseFloat(amount).toLocaleString()}{" "}
                        {selectedToken.symbol}
                      </span>
                    </div>
                    <div className="buy-summary-row">
                      <span>{t("buy_you_pay")}</span>
                      <span>{formatPrice(tokenCost + getFee())}</span>
                    </div>
                    <div className="buy-summary-row">
                      <span>{t("buy_fee")} (3.5%)</span>
                      <span>{formatPrice(getFee())}</span>
                    </div>
                    <div className="buy-summary-row">
                      <span>{t("buy_rate")}</span>
                      <span>
                        1 {selectedToken.symbol} ={" "}
                        {hasRealPrice(selectedToken.id)
                          ? formatPrice(getTokenPrice(selectedToken.id))
                          : "--"}
                      </span>
                    </div>
                  </div>
                )}

              {mode === "buy" &&
                paymentMethod === "crypto" &&
                cryptoEstimate && (
                  <div className="buy-summary">
                    {cryptoEstimate.belowMinimum && (
                      <div
                        style={{
                          color: "#ff6b6b",
                          fontSize: "0.85rem",
                          marginBottom: "0.5rem",
                          padding: "0.5rem",
                          background: "rgba(255,107,107,0.1)",
                          borderRadius: "8px",
                          textAlign: "center",
                        }}
                      >
                        Minimum purchase is $
                        {cryptoEstimate.minUsdAmount?.toFixed(2) || "—"} USD (
                        {cryptoEstimate.minNtcAmount}{" "}
                        {cryptoEstimate.tokenSymbol ||
                          activeToken?.symbol ||
                          "NTC"}
                        ) for {selectedCryptoCurrency.toUpperCase()} payments
                      </div>
                    )}
                    <div className="buy-summary-row">
                      <span>You spend</span>
                      <span>${cryptoEstimate.totalUsd?.toFixed(2)} USD</span>
                    </div>
                    <div className="buy-summary-row">
                      <span>{t("buy_you_receive")}</span>
                      <span>
                        ~
                        {cryptoEstimate.ntcAmount?.toLocaleString(undefined, {
                          maximumFractionDigits: 4,
                        })}{" "}
                        {cryptoEstimate.tokenSymbol ||
                          activeToken?.symbol ||
                          "NTC"}
                      </span>
                    </div>
                    <div className="buy-summary-row">
                      <span>{t("buy_you_pay")}</span>
                      <span>
                        {cryptoEstimate.estimatedPayAmount}{" "}
                        {selectedCryptoCurrency.toUpperCase()}
                      </span>
                    </div>
                    <div className="buy-summary-row">
                      <span>{activeToken?.symbol || "NTC"} Price</span>
                      <span>${cryptoEstimate.ntcPriceUsd?.toFixed(6)} USD</span>
                    </div>
                  </div>
                )}

              {mode === "sell" && amount && parseFloat(amount) > 0 && (
                <div className="buy-summary">
                  <div className="buy-summary-row">
                    <span>{t("sell_you_send") || "You send"}</span>
                    <span>
                      {parseFloat(amount).toLocaleString()}{" "}
                      {selectedToken.symbol}
                    </span>
                  </div>
                  <div className="buy-summary-row">
                    <span>{t("sell_you_receive") || "You receive"}</span>
                    <span>{formatPrice(sellEstimateFiat)}</span>
                  </div>
                  <div className="buy-summary-row">
                    <span>{t("sell_fee") || "Fee"} (3.5%)</span>
                    <span>
                      {formatPrice(
                        parseFloat(amount) *
                          (getTokenPrice(selectedToken.id) || 1) *
                          0.035,
                      )}
                    </span>
                  </div>
                  <div className="buy-summary-row">
                    <span>{t("buy_rate")}</span>
                    <span>
                      1 {selectedToken.symbol} ={" "}
                      {hasRealPrice(selectedToken.id)
                        ? formatPrice(getTokenPrice(selectedToken.id))
                        : "--"}
                    </span>
                  </div>
                </div>
              )}

              <button
                className="buy-submit-btn"
                onClick={() => {
                  if (paymentMethod === "crypto" && !showConfirmDialog) {
                    setShowConfirmDialog(true);
                    return;
                  }
                  handlePurchase();
                }}
                disabled={
                  !amount ||
                  parseFloat(amount) <= 0 ||
                  !connected ||
                  moonpayLoading ||
                  cryptoLoading ||
                  submitted ||
                  (paymentMethod === "moonpay" && !hasApiKey) ||
                  (paymentMethod === "crypto" &&
                    cryptoEstimate?.belowMinimum) ||
                  (paymentMethod === "crypto" &&
                    parseFloat(amount) < MIN_DOLLAR_AMOUNT)
                }
                style={
                  mode === "sell"
                    ? {
                        background: "linear-gradient(135deg, #ff6b6b, #ee5a24)",
                      }
                    : {}
                }
              >
                {cryptoLoading
                  ? "Creating Payment..."
                  : submitted && paymentMethod === "crypto"
                    ? "Processing..."
                    : moonpayLoading
                      ? (mode === "sell"
                          ? t("sell_processing") || "Processing Sale"
                          : t("buy_processing")) + "..."
                      : paymentMethod === "moonpay" && !hasApiKey
                        ? (t("unavailable") || "Unavailable")
                        : !connected
                          ? t("exch_connect_wallet")
                          : mode === "sell"
                            ? `${t("exch_sell")} ${selectedToken.symbol}`
                            : paymentMethod === "crypto"
                              ? showConfirmDialog
                                ? "Confirm Purchase"
                                : `Buy with ${selectedCryptoCurrency.toUpperCase()}`
                              : `${t("exch_buy")} ${selectedToken.symbol} ${t("buy_with")} ${t(selectedPayment?.nameKey)}`}
              </button>

              {showConfirmDialog &&
                paymentMethod === "crypto" &&
                cryptoEstimate && (
                  <div
                    style={{
                      marginTop: 12,
                      padding: "14px 16px",
                      background: "rgba(0,212,170,0.08)",
                      border: "1px solid rgba(0,212,170,0.25)",
                      borderRadius: 10,
                    }}
                  >
                    <div
                      style={{
                        color: "#fff",
                        fontSize: 13,
                        fontWeight: 600,
                        marginBottom: 8,
                      }}
                    >
                      Confirm your purchase:
                    </div>
                    <div
                      style={{ color: "#aaa", fontSize: 12, marginBottom: 4 }}
                    >
                      Spend:{" "}
                      <strong style={{ color: "#fff" }}>
                        ${cryptoEstimate.totalUsd?.toFixed(2)} USD
                      </strong>
                    </div>
                    <div
                      style={{ color: "#aaa", fontSize: 12, marginBottom: 4 }}
                    >
                      Receive:{" "}
                      <strong style={{ color: "#00d4aa" }}>
                        ~
                        {cryptoEstimate.ntcAmount?.toLocaleString(undefined, {
                          maximumFractionDigits: 4,
                        })}{" "}
                        {cryptoEstimate.tokenSymbol ||
                          activeToken?.symbol ||
                          "NTC"}
                      </strong>
                    </div>
                    <div
                      style={{ color: "#aaa", fontSize: 12, marginBottom: 12 }}
                    >
                      Pay with wallet:{" "}
                      <strong style={{ color: "#fff" }}>
                        {cryptoEstimate.estimatedPayAmount}{" "}
                        {selectedCryptoCurrency.toUpperCase()}
                      </strong>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={() => setShowConfirmDialog(false)}
                        style={{
                          flex: 1,
                          padding: "8px",
                          background: "transparent",
                          border: "1px solid rgba(255,255,255,0.15)",
                          color: "#aaa",
                          borderRadius: 8,
                          cursor: "pointer",
                          fontSize: 12,
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handlePurchase}
                        disabled={cryptoLoading || submitted}
                        style={{
                          flex: 2,
                          padding: "8px",
                          background: "rgba(0,212,170,0.15)",
                          border: "1px solid rgba(0,212,170,0.3)",
                          color: "#00d4aa",
                          borderRadius: 8,
                          cursor: "pointer",
                          fontSize: 12,
                          fontWeight: 600,
                        }}
                      >
                        {cryptoLoading ? "Processing..." : "Confirm & Continue"}
                      </button>
                    </div>
                  </div>
                )}


              {!connected && (
                <div className="buy-wallet-notice">
                  {t("buy_wallet_notice")}
                </div>
              )}
            </>
          )}

          {step === "crypto-pay" && cryptoPayment && (
            <div style={{ textAlign: "center", padding: "10px 0" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>
                <Coins size={40} />
              </div>
              <h2 style={{ margin: "0 0 8px", color: "#fff" }}>Send Payment</h2>
              <p style={{ color: "#aaa", fontSize: 13, marginBottom: 20 }}>
                Connect your wallet and send the exact amount below
              </p>

              <div
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 12,
                  padding: 20,
                  marginBottom: 16,
                  textAlign: "left",
                }}
              >
                <div style={{ marginBottom: 14 }}>
                  <div style={{ color: "#888", fontSize: 11, marginBottom: 4 }}>
                    Amount to Send
                  </div>
                  <div
                    style={{ color: "#00d4aa", fontSize: 22, fontWeight: 700 }}
                  >
                    {cryptoPayment.payAmount}{" "}
                    {cryptoPayment.payCurrency?.toUpperCase()}
                  </div>
                </div>

                <div style={{ marginBottom: 14 }}>
                  <div style={{ color: "#888", fontSize: 11, marginBottom: 4 }}>
                    {getCurrencyType(cryptoPayment.payCurrency) === "solana"
                      ? "Pay with Phantom Wallet"
                      : "Pay with Wallet (WalletConnect)"}
                  </div>
                  {!cryptoWallet.txHash ? (
                    <>
                      {getCurrencyType(cryptoPayment.payCurrency) ===
                      "solana" ? (
                        /* SOL — Phantom browser wallet directly */
                        <>
                          <button
                            disabled={
                              cryptoWallet.connecting || cryptoWallet.sending
                            }
                            onClick={() =>
                              cryptoWallet.connectAndSendSol(
                                cryptoPayment.payAddress,
                                cryptoPayment.payAmount,
                              )
                            }
                            style={{
                              width: "100%",
                              padding: "10px",
                              background: "rgba(153,69,255,0.15)",
                              border: "1px solid rgba(153,69,255,0.3)",
                              color: "#9945FF",
                              borderRadius: 8,
                              cursor: "pointer",
                              fontSize: 13,
                              fontWeight: 600,
                            }}
                          >
                            {cryptoWallet.connecting
                              ? "Connecting Phantom..."
                              : cryptoWallet.sending
                                ? "Confirm in Phantom..."
                                : `Pay ${cryptoPayment.payAmount} SOL with Phantom`}
                          </button>
                          {!cryptoWallet.isPhantomInstalled && (
                            <div
                              style={{
                                marginTop: 6,
                                fontSize: 11,
                                color: "#f0ad4e",
                              }}
                            >
                              Phantom wallet not detected.{" "}
                              <a
                                href="https://phantom.app"
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  color: "#9945FF",
                                  textDecoration: "underline",
                                }}
                              >
                                Install Phantom
                              </a>
                            </div>
                          )}
                        </>
                      ) : (
                        /* EVM — WalletConnect / browser wallet */
                        <button
                          disabled={
                            cryptoWallet.connecting || cryptoWallet.sending
                          }
                          onClick={() =>
                            cryptoWallet.connectAndSendEvm(
                              cryptoPayment.payCurrency,
                              cryptoPayment.payAddress,
                              cryptoPayment.payAmount,
                            )
                          }
                          style={{
                            width: "100%",
                            padding: "10px",
                            background: "rgba(0,212,170,0.15)",
                            border: "1px solid rgba(0,212,170,0.3)",
                            color: "#00d4aa",
                            borderRadius: 8,
                            cursor: "pointer",
                            fontSize: 13,
                            fontWeight: 600,
                          }}
                        >
                          {cryptoWallet.connecting
                            ? "Opening WalletConnect..."
                            : cryptoWallet.sending
                              ? "Confirm in wallet..."
                              : `Connect Wallet & Pay ${cryptoPayment.payAmount} ${cryptoPayment.payCurrency?.toUpperCase()}`}
                        </button>
                      )}
                    </>
                  ) : (
                    <div
                      style={{
                        padding: "8px 12px",
                        background: "rgba(0,212,170,0.08)",
                        borderRadius: 8,
                        fontSize: 12,
                        color: "#00d4aa",
                        textAlign: "center",
                      }}
                    >
                      Payment sent! Tx: {cryptoWallet.txHash.slice(0, 10)}...
                      {cryptoWallet.txHash.slice(-6)}
                    </div>
                  )}

                  {cryptoWallet.error && (
                    <div
                      style={{ color: "#d9534f", fontSize: 11, marginTop: 6 }}
                    >
                      {cryptoWallet.error}
                    </div>
                  )}
                </div>

                <div>
                  <div style={{ color: "#888", fontSize: 11, marginBottom: 4 }}>
                    You will receive
                  </div>
                  <div style={{ color: "#fff", fontSize: 16, fontWeight: 600 }}>
                    ~
                    {typeof cryptoPayment.ntcAmount === "number"
                      ? cryptoPayment.ntcAmount.toLocaleString(undefined, {
                          maximumFractionDigits: 4,
                        })
                      : cryptoPayment.ntcAmount}{" "}
                    {cryptoPayment.tokenSymbol || activeToken?.symbol || "NTC"}
                  </div>
                  <div style={{ color: "#888", fontSize: 12 }}>
                    ${cryptoPayment.totalUsd?.toFixed(2)} USD
                  </div>
                </div>

                {import.meta.env.VITE_NOWPAYMENTS_SANDBOX !== "true" ? null : (
                  <div
                    style={{
                      marginTop: 8,
                      padding: "4px 8px",
                      background: "rgba(240,173,78,0.12)",
                      borderRadius: 6,
                      fontSize: 10,
                      color: "#f0ad4e",
                      textAlign: "center",
                    }}
                  >
                    TESTNET MODE — Using sandbox chains
                  </div>
                )}
              </div>

              {paymentStatus && (
                <div
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 10,
                    padding: "12px 16px",
                    marginBottom: 16,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span style={{ color: "#888", fontSize: 12 }}>
                      Payment Status
                    </span>
                    <span
                      style={{
                        color: getStatusColor(
                          paymentStatus.nowpayments_status ||
                            paymentStatus.status,
                        ),
                        fontSize: 13,
                        fontWeight: 600,
                        textTransform: "capitalize",
                      }}
                    >
                      {paymentStatus.nowpayments_status ||
                        paymentStatus.status ||
                        "waiting"}
                    </span>
                  </div>
                  {paymentStatus.status === "sending" && (
                    <div
                      style={{ marginTop: 8, color: "#5bc0de", fontSize: 12 }}
                    >
                      Payment confirmed. Sending{" "}
                      {cryptoPayment?.tokenSymbol ||
                        activeToken?.symbol ||
                        "NTC"}{" "}
                      to your wallet...
                    </div>
                  )}
                  {(paymentStatus.status === "completed" ||
                    paymentStatus.status === "finished") &&
                    paymentStatus.ntc_tx_signature && (
                      <div style={{ marginTop: 8 }}>
                        <a
                          href={explorerTxUrl(paymentStatus.ntc_tx_signature)}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            color: "#00d4aa",
                            fontSize: 12,
                            textDecoration: "none",
                          }}
                        >
                          View Transaction ↗
                        </a>
                      </div>
                    )}
                </div>
              )}

              {paymentStatus?.status === "failed" ||
              paymentStatus?.status === "expired" ||
              paymentStatus?.status === "refunded" ? (
                <div style={{ textAlign: "center", marginBottom: 16 }}>
                  <div
                    style={{
                      color: "#d9534f",
                      fontSize: 14,
                      fontWeight: 600,
                      marginBottom: 8,
                    }}
                  >
                    Payment{" "}
                    {paymentStatus.status === "expired" ? "expired" : "failed"}
                  </div>
                  <button
                    onClick={handleReset}
                    style={{
                      width: "100%",
                      padding: "10px",
                      background: "rgba(0,212,170,0.15)",
                      border: "1px solid rgba(0,212,170,0.3)",
                      color: "#00d4aa",
                      borderRadius: 8,
                      cursor: "pointer",
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    Try Again
                  </button>
                </div>
              ) : (paymentStatus?.status === "completed" ||
                  paymentStatus?.status === "finished") &&
                paymentStatus?.ntc_tx_signature ? (
                <div style={{ textAlign: "center", marginBottom: 16 }}>
                  <div
                    style={{ color: "#00d4aa", fontSize: 14, fontWeight: 600 }}
                  >
                    Payment complete! {activeToken?.symbol || "NTC"} tokens
                    delivered.
                  </div>
                </div>
              ) : (
                <>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      justifyContent: "center",
                      color: "#888",
                      fontSize: 12,
                      marginBottom: 16,
                    }}
                  >
                    <div
                      className="buy-spinner"
                      style={{ width: 14, height: 14, borderWidth: 2 }}
                    ></div>
                    {cryptoWallet.sending
                      ? "Confirm transaction in your wallet..."
                      : cryptoWallet.txHash
                        ? "Transaction sent. Waiting for confirmation..."
                        : paymentStatus?.status === "confirming"
                          ? "Payment detected. Confirming..."
                          : paymentStatus?.status === "sending" ||
                              ((paymentStatus?.status === "completed" ||
                                paymentStatus?.status === "finished") &&
                                !paymentStatus?.ntc_tx_signature)
                            ? `Payment confirmed. Sending ${cryptoPayment?.tokenSymbol || activeToken?.symbol || "NTC"} to your wallet...`
                            : "Waiting for payment..."}
                  </div>

                  {import.meta.env.VITE_NOWPAYMENTS_SANDBOX === "true" &&
                    paymentStatus?.status !== "completed" &&
                    paymentStatus?.status !== "sending" && (
                      <button
                        onClick={async () => {
                          try {
                            const res = await fetch(
                              "/api/buy/sandbox-simulate",
                              {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  purchaseId: cryptoPayment.purchaseId,
                                }),
                              },
                            );
                            const d = await res.json();
                            if (!d.ok)
                              setCryptoError(d.error || "Simulation failed");
                          } catch {
                            setCryptoError("Simulation failed");
                          }
                        }}
                        style={{
                          width: "100%",
                          padding: "10px",
                          marginBottom: 10,
                          background: "rgba(240,173,78,0.15)",
                          border: "1px solid rgba(240,173,78,0.3)",
                          color: "#f0ad4e",
                          borderRadius: 8,
                          cursor: "pointer",
                          fontSize: 13,
                          fontWeight: 600,
                        }}
                      >
                        Simulate Payment (Sandbox)
                      </button>
                    )}

                  <button
                    className="buy-cancel-btn"
                    onClick={handleReset}
                    disabled={isPaymentLocked}
                    style={{
                      width: "100%",
                      opacity: isPaymentLocked ? 0.5 : 1,
                      cursor: isPaymentLocked ? "not-allowed" : "pointer",
                    }}
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>
          )}

          {step === "processing" && (
            <div className="buy-processing">
              <div className="buy-spinner"></div>
              <h2>
                {mode === "sell"
                  ? t("sell_processing") || "Processing Sale"
                  : t("buy_processing")}
              </h2>
              <p>
                {mode === "sell"
                  ? t("sell_processing_wait") ||
                    "Complete your sale in the MoonPay window..."
                  : paymentMethod === "moonpay"
                    ? "Complete your purchase in the MoonPay window..."
                    : t("buy_processing_wait")}
              </p>
              {onchainStep && (
                <div
                  style={{
                    marginTop: 16,
                    padding: "10px 16px",
                    background: "rgba(0,212,170,0.08)",
                    border: "1px solid rgba(0,212,170,0.2)",
                    borderRadius: 8,
                    fontSize: 13,
                    color: "#00d4aa",
                  }}
                >
                  {onchainStep === "building_transfer" &&
                    "Building token transfer..."}
                  {onchainStep === "signing_transfer" &&
                    "Please sign the transfer in your wallet..."}
                  {onchainStep === "sending_transfer" &&
                    "Sending transfer to Solana..."}
                </div>
              )}
            </div>
          )}

          {step === "success" && (
            <div className="buy-success">
              <div className="buy-success-icon">✓</div>
              <h2>
                {mode === "sell"
                  ? t("sell_success") || "Sale Complete!"
                  : t("buy_success")}
              </h2>
              <p>
                {mode === "sell"
                  ? (t("sell_success_msg") || "Successfully sold") +
                    " " +
                    parseFloat(amount).toLocaleString() +
                    " " +
                    activeToken.symbol
                  : paymentMethod === "crypto" && cryptoPayment
                    ? (t("buy_success_msg") || "Successfully purchased") +
                      " ~" +
                      (cryptoPayment.ntcAmount?.toLocaleString(undefined, {
                        maximumFractionDigits: 4,
                      }) || "?") +
                      " " +
                      (cryptoPayment.tokenSymbol ||
                        activeToken?.symbol ||
                        "NTC")
                    : (t("buy_success_msg") || "Successfully purchased") +
                      " " +
                      parseFloat(amount).toLocaleString() +
                      " " +
                      activeToken.symbol}
              </p>
              <div className="buy-summary" style={{ marginTop: "20px" }}>
                <div className="buy-summary-row">
                  <span>{t("markets_token")}</span>
                  <span>{activeToken?.symbol || "NTC"}</span>
                </div>
                <div className="buy-summary-row">
                  <span>{t("exch_amount")}</span>
                  <span>
                    {paymentMethod === "crypto" && cryptoPayment
                      ? "~" +
                        (cryptoPayment.ntcAmount?.toLocaleString(undefined, {
                          maximumFractionDigits: 4,
                        }) || "?") +
                        " " +
                        (cryptoPayment.tokenSymbol ||
                          activeToken?.symbol ||
                          "NTC")
                      : parseFloat(amount).toLocaleString()}
                  </span>
                </div>
                {mode === "sell" ? (
                  <div className="buy-summary-row">
                    <span>{t("sell_estimated_payout")}</span>
                    <span>{formatPrice(sellEstimateFiat)}</span>
                  </div>
                ) : paymentMethod === "crypto" && cryptoPayment ? (
                  <>
                    <div className="buy-summary-row">
                      <span>You spent</span>
                      <span>${cryptoPayment.totalUsd?.toFixed(2)} USD</span>
                    </div>
                    <div className="buy-summary-row">
                      <span>Paid with wallet</span>
                      <span>
                        {cryptoPayment.payAmount}{" "}
                        {cryptoPayment.payCurrency?.toUpperCase()}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="buy-summary-row">
                    <span>{t("buy_total_paid")}</span>
                    <span>{formatPrice(tokenCost + getFee())}</span>
                  </div>
                )}
                {paymentStatus?.ntc_tx_signature && (
                  <div className="buy-summary-row">
                    <span>Transaction</span>
                    <a
                      href={explorerTxUrl(paymentStatus.ntc_tx_signature)}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: "#00d4aa",
                        fontSize: 12,
                        textDecoration: "none",
                      }}
                    >
                      {paymentStatus.ntc_tx_signature.slice(0, 8)}...
                      {paymentStatus.ntc_tx_signature.slice(-6)}
                    </a>
                  </div>
                )}
                {transactions.length > 0 &&
                  transactions[0].tx_signature &&
                  !paymentStatus?.ntc_tx_signature && (
                    <div className="buy-summary-row">
                      <span>Transaction</span>
                      <a
                        href={explorerTxUrl(transactions[0].tx_signature)}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          color: "#00d4aa",
                          fontSize: 12,
                          textDecoration: "none",
                        }}
                      >
                        {transactions[0].tx_signature.slice(0, 8)}...
                        {transactions[0].tx_signature.slice(-6)}
                      </a>
                    </div>
                  )}
              </div>
              <button
                className="buy-submit-btn"
                onClick={handleReset}
                style={{ marginTop: "20px" }}
              >
                {mode === "sell"
                  ? t("sell_title") || "Sell More"
                  : t("buy_more")}
              </button>
            </div>
          )}
        </div>

        <div className="buy-info-panel">
          {cryptoPurchases.length > 0 && (
            <div className="info-card">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 12,
                }}
              >
                <h3 style={{ margin: 0 }}>Crypto Purchases</h3>
              </div>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 13,
                }}
              >
                <thead>
                  <tr
                    style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}
                  >
                    <th
                      style={{
                        textAlign: "left",
                        padding: "6px 4px",
                        color: "#888",
                        fontWeight: 500,
                        fontSize: 11,
                      }}
                    >
                      Token
                    </th>
                    <th
                      style={{
                        textAlign: "left",
                        padding: "6px 4px",
                        color: "#888",
                        fontWeight: 500,
                        fontSize: 11,
                      }}
                    >
                      Paid
                    </th>
                    <th
                      style={{
                        textAlign: "left",
                        padding: "6px 4px",
                        color: "#888",
                        fontWeight: 500,
                        fontSize: 11,
                      }}
                    >
                      Status
                    </th>
                    <th
                      style={{
                        textAlign: "right",
                        padding: "6px 4px",
                        color: "#888",
                        fontWeight: 500,
                        fontSize: 11,
                      }}
                    >
                      Date
                    </th>
                    <th
                      style={{
                        textAlign: "center",
                        padding: "6px 4px",
                        color: "#888",
                        fontWeight: 500,
                        fontSize: 11,
                      }}
                    >
                      Tx
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {cryptoPurchases.slice(0, 10).map((p) => (
                    <tr
                      key={p.id}
                      style={{
                        borderBottom: "1px solid rgba(255,255,255,0.04)",
                      }}
                    >
                      <td
                        style={{
                          padding: "8px 4px",
                          color: "#00d4aa",
                          fontWeight: 600,
                        }}
                      >
                        {Number(p.ntc_amount).toFixed(2)}{" "}
                        {p.token_symbol || "NTC"}
                      </td>
                      <td style={{ padding: "8px 4px" }}>
                        {Number(p.pay_amount).toFixed(6)}{" "}
                        {p.pay_currency?.toUpperCase()}
                      </td>
                      <td style={{ padding: "8px 4px" }}>
                        <span
                          style={{
                            color: getStatusColor(p.status),
                            textTransform: "capitalize",
                            fontSize: 12,
                          }}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td
                        style={{
                          textAlign: "right",
                          padding: "8px 4px",
                          color: "#888",
                          fontSize: 11,
                        }}
                      >
                        {formatTimeAgo(p.created_at)}
                      </td>
                      <td style={{ textAlign: "center", padding: "8px 4px" }}>
                        {p.ntc_tx_signature ? (
                          <a
                            href={explorerTxUrl(p.ntc_tx_signature)}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              color: "#00d4aa",
                              fontSize: 11,
                              textDecoration: "none",
                            }}
                          >
                            {p.ntc_tx_signature.slice(0, 6)}...
                          </a>
                        ) : (
                          <span style={{ color: "#555", fontSize: 11 }}>
                            --
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {transactions.length > 0 && (
            <div className="info-card">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 12,
                }}
              >
                <h3 style={{ margin: 0 }}>
                  {t("buy_recent_transactions") || "Recent Transactions"}
                </h3>
                <button
                  onClick={fetchTransactions}
                  style={{
                    background: "none",
                    border: "1px solid rgba(255,255,255,0.15)",
                    borderRadius: 6,
                    color: "#aaa",
                    cursor: "pointer",
                    padding: "4px 10px",
                    fontSize: 12,
                  }}
                >
                  Refresh
                </button>
              </div>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 13,
                }}
              >
                <thead>
                  <tr
                    style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}
                  >
                    <th
                      style={{
                        textAlign: "left",
                        padding: "6px 4px",
                        color: "#888",
                        fontWeight: 500,
                        fontSize: 11,
                      }}
                    >
                      Type
                    </th>
                    <th
                      style={{
                        textAlign: "left",
                        padding: "6px 4px",
                        color: "#888",
                        fontWeight: 500,
                        fontSize: 11,
                      }}
                    >
                      Status
                    </th>
                    <th
                      style={{
                        textAlign: "right",
                        padding: "6px 4px",
                        color: "#888",
                        fontWeight: 500,
                        fontSize: 11,
                      }}
                    >
                      Price
                    </th>
                    <th
                      style={{
                        textAlign: "right",
                        padding: "6px 4px",
                        color: "#888",
                        fontWeight: 500,
                        fontSize: 11,
                      }}
                    >
                      Fiat
                    </th>
                    <th
                      style={{
                        textAlign: "right",
                        padding: "6px 4px",
                        color: "#888",
                        fontWeight: 500,
                        fontSize: 11,
                      }}
                    >
                      Crypto
                    </th>
                    <th
                      style={{
                        textAlign: "right",
                        padding: "6px 4px",
                        color: "#888",
                        fontWeight: 500,
                        fontSize: 11,
                      }}
                    >
                      Date
                    </th>
                    <th
                      style={{
                        textAlign: "center",
                        padding: "6px 4px",
                        color: "#888",
                        fontWeight: 500,
                        fontSize: 11,
                      }}
                    >
                      Tx
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.slice(0, 10).map((tx) => (
                    <tr
                      key={tx.id}
                      style={{
                        borderBottom: "1px solid rgba(255,255,255,0.04)",
                      }}
                    >
                      <td style={{ padding: "8px 4px" }}>
                        <span
                          style={{
                            color: tx.type === "sell" ? "#ff6b6b" : "#00d4aa",
                            textTransform: "capitalize",
                            fontSize: 12,
                            fontWeight: 600,
                          }}
                        >
                          {tx.type === "sell" ? t("exch_sell") : t("exch_buy")}
                        </span>
                      </td>
                      <td style={{ padding: "8px 4px" }}>
                        <span
                          style={{
                            color: getStatusColor(tx.status),
                            textTransform: "capitalize",
                            fontSize: 12,
                          }}
                        >
                          {tx.status.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td style={{ textAlign: "right", padding: "8px 4px" }}>
                        {tx.token_price > 0
                          ? formatPrice(tx.token_price)
                          : "--"}
                      </td>
                      <td style={{ textAlign: "right", padding: "8px 4px" }}>
                        {tx.amount_fiat > 0
                          ? `$${Number(tx.amount_fiat).toFixed(2)}`
                          : "--"}
                        {tx.fiat_currency && tx.fiat_currency !== "USD" && (
                          <span
                            style={{
                              fontSize: 10,
                              color: "#888",
                              marginLeft: 2,
                            }}
                          >
                            {tx.fiat_currency}
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: "right", padding: "8px 4px" }}>
                        {tx.amount_crypto > 0
                          ? Number(tx.amount_crypto).toFixed(4)
                          : "--"}
                        <span
                          style={{ fontSize: 10, color: "#888", marginLeft: 2 }}
                        >
                          {tx.crypto_currency?.toUpperCase() || ""}
                        </span>
                      </td>
                      <td
                        style={{
                          textAlign: "right",
                          padding: "8px 4px",
                          color: "#888",
                          fontSize: 11,
                        }}
                      >
                        {formatTimeAgo(tx.created_at)}
                      </td>
                      <td style={{ textAlign: "center", padding: "8px 4px" }}>
                        {tx.tx_signature ? (
                          <a
                            href={explorerTxUrl(tx.tx_signature)}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              color: "#00d4aa",
                              fontSize: 11,
                              textDecoration: "none",
                            }}
                            title={tx.tx_signature}
                          >
                            {tx.tx_signature.slice(0, 6)}...
                          </a>
                        ) : (
                          <span style={{ color: "#555", fontSize: 11 }}>
                            --
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="info-card">
            <h3>{t("buy_why_title")}</h3>
            <ul className="buy-benefits">
              <li>{t("buy_benefit_1")}</li>
              <li>{t("buy_benefit_2")}</li>
              <li>{t("buy_benefit_3")}</li>
              <li>{t("buy_benefit_4")}</li>
            </ul>
          </div>
          <div className="info-card">
            <h3>{t("buy_payment_methods_title")}</h3>
            <div className="buy-method-info">
              <div className="buy-method-row">
                <span>
                  <CreditCard
                    size={14}
                    style={{ verticalAlign: "middle", marginRight: 4 }}
                  />
                  MoonPay
                </span>
                <span>{t("buy_method_card")}</span>
              </div>
              <div className="buy-method-row">
                <span>
                  <Coins
                    size={14}
                    style={{ verticalAlign: "middle", marginRight: 4 }}
                  />
                  Crypto
                </span>
                <span>Pay with ETH, SOL, USDT, USDC & more via wallet</span>
              </div>
            </div>
          </div>
          <div className="info-card">
            <h3>{t("buy_need_help")}</h3>
            <p>{t("buy_help_text")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default BuyTokens;
