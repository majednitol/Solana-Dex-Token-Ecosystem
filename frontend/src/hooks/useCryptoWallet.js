////useCryptoWallet.js
import { useState, useCallback, useEffect, useRef } from "react";
import { initAppKit, resetAppKit } from "../config/appkit";

const CURRENCY_MAP = {
  eth: { type: "evm", chain: "ethereum", native: true },
  bnb: { type: "evm", chain: "bsc", native: true },
  bnbbsc: { type: "evm", chain: "bsc", native: true },
  matic: { type: "evm", chain: "polygon", native: true },
  maticpoly: { type: "evm", chain: "polygon", native: true },
  avax: { type: "evm", chain: "avalanche", native: true },

  usdterc20: {
    type: "evm",
    chain: "ethereum",
    native: false,
    contract: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    decimals: 6,
  },
  usdtbsc: {
    type: "evm",
    chain: "bsc",
    native: false,
    contract: "0x55d398326f99059fF775485246999027B3197955",
    decimals: 18,
  },
  usdtmatic: {
    type: "evm",
    chain: "polygon",
    native: false,
    contract: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    decimals: 6,
  },
  usdtarb: {
    type: "evm",
    chain: "arbitrum",
    native: false,
    contract: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    decimals: 6,
  },
  usdtop: {
    type: "evm",
    chain: "optimism",
    native: false,
    contract: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
    decimals: 6,
  },
  usdtbase: {
    type: "evm",
    chain: "base",
    native: false,
    contract: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
    decimals: 6,
  },

  usdcerc20: {
    type: "evm",
    chain: "ethereum",
    native: false,
    contract: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    decimals: 6,
  },
  usdcbsc: {
    type: "evm",
    chain: "bsc",
    native: false,
    contract: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    decimals: 18,
  },
  usdcmatic: {
    type: "evm",
    chain: "polygon",
    native: false,
    contract: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    decimals: 6,
  },
  usdcarb: {
    type: "evm",
    chain: "arbitrum",
    native: false,
    contract: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    decimals: 6,
  },
  usdcop: {
    type: "evm",
    chain: "optimism",
    native: false,
    contract: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    decimals: 6,
  },
  usdcbase: {
    type: "evm",
    chain: "base",
    native: false,
    contract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    decimals: 6,
  },

  daierc20: {
    type: "evm",
    chain: "ethereum",
    native: false,
    contract: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    decimals: 18,
  },
  busdbsc: {
    type: "evm",
    chain: "bsc",
    native: false,
    contract: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56",
    decimals: 18,
  },

  wbtcerc20: {
    type: "evm",
    chain: "ethereum",
    native: false,
    contract: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
    decimals: 8,
  },
  wbtcmatic: {
    type: "evm",
    chain: "polygon",
    native: false,
    contract: "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6",
    decimals: 8,
  },

  linkerc20: {
    type: "evm",
    chain: "ethereum",
    native: false,
    contract: "0x514910771AF9Ca656af840dff83E8264EcF986CA",
    decimals: 18,
  },
  unierc20: {
    type: "evm",
    chain: "ethereum",
    native: false,
    contract: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
    decimals: 18,
  },
  shiberc20: {
    type: "evm",
    chain: "ethereum",
    native: false,
    contract: "0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE",
    decimals: 18,
  },

  sol: { type: "solana", native: true },
  usdtsol: { type: "solana", native: false },
};

const EVM_CHAIN_IDS = {
  ethereum: 1,
  bsc: 56,
  polygon: 137,
  arbitrum: 42161,
  optimism: 10,
  base: 8453,
  avalanche: 43114,
};

export function getCurrencyType(currency) {
  const info = CURRENCY_MAP[currency?.toLowerCase()];
  if (!info) return "wallet";
  return info.type;
}

export function getWalletName() {
  return "Wallet";
}

export function getWalletInstallUrl() {
  return "https://walletconnect.com/";
}

/**
 * Check if Phantom browser wallet is installed
 */
export function isPhantomInstalled() {
  if (typeof window === "undefined") return false;
  return !!(window.solana?.isPhantom || window.phantom?.solana?.isPhantom);
}

/**
 * Get the Phantom Solana provider from the browser
 */
function getPhantomProvider() {
  if (typeof window === "undefined") return null;
  // Prefer window.phantom.solana (newer API)
  if (window.phantom?.solana?.isPhantom) return window.phantom.solana;
  // Fallback to window.solana
  if (window.solana?.isPhantom) return window.solana;
  return null;
}

function getEvmProvider() {
  if (typeof window === "undefined") return null;
  if (window.ethereum?.providers?.length) {
    const nonPhantom = window.ethereum.providers.find((p) => !p.isPhantom);
    if (nonPhantom) return nonPhantom;
  }
  if (window.ethereum && !window.ethereum.isPhantom) return window.ethereum;
  if (window.ethereum) return window.ethereum;
  return null;
}

export default function useCryptoWallet() {
  const [walletAddress, setWalletAddress] = useState(null);
  const [walletType, setWalletType] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [txHash, setTxHash] = useState("");

  const appkitRef = useRef(null);
  const pendingPaymentRef = useRef(null);

  const resetState = useCallback(() => {
    setTxHash("");
    setError("");
    setSending(false);
    setConnecting(false);
    setWalletAddress(null);
    setWalletType(null);
    pendingPaymentRef.current = null;
  }, []);

  // ============================================================
  // SOL PAYMENT — Uses Phantom browser wallet DIRECTLY
  // No WalletConnect / AppKit involved at all
  // ============================================================
  const connectAndSendSol = useCallback(async (recipientAddress, amount) => {
    setError("");
    setTxHash("");
    setConnecting(true);

    try {
      const phantom = getPhantomProvider();
      if (!phantom) {
        setError(
          "Phantom wallet not found. Please install Phantom browser extension.",
        );
        setConnecting(false);
        return null;
      }

      // Connect if not already connected
      if (!phantom.isConnected) {
        await phantom.connect();
      }

      setConnecting(false);
      setSending(true);

      const {
        Connection,
        PublicKey,
        Transaction,
        SystemProgram,
        LAMPORTS_PER_SOL,
      } = await import("@solana/web3.js");

      const rpcUrl =
        import.meta.env.VITE_SOLANA_RPC_URL ||
        "https://api.mainnet-beta.solana.com";
      const connection = new Connection(rpcUrl, "confirmed");

      const fromPubkey = phantom.publicKey;
      const toPubkey = new PublicKey(recipientAddress);
      const lamports = Math.round(parseFloat(amount) * LAMPORTS_PER_SOL);

      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey,
          toPubkey,
          lamports,
        }),
      );

      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = fromPubkey;

      const signed = await phantom.signAndSendTransaction(transaction);
      const signature = signed.signature || signed;
      const sigStr =
        typeof signature === "string" ? signature : signature.toString();
      setTxHash(sigStr);
      setSending(false);
      return sigStr;
    } catch (e) {
      if (
        e.code === 4001 ||
        e.message?.includes("rejected") ||
        e.message?.includes("User rejected")
      ) {
        setError("Transaction rejected by user");
      } else {
        const msg = e.message || "Transaction failed";
        setError(msg.length > 120 ? msg.substring(0, 120) + "..." : msg);
      }
      setSending(false);
      setConnecting(false);
      return null;
    }
  }, []);

  // ============================================================
  // EVM PAYMENT — Uses WalletConnect / AppKit
  // Always resets previous state before opening modal
  // ============================================================
  const connectAndSendEvm = useCallback(
    async (currency, recipientAddress, amount) => {
      setError("");
      setTxHash("");
      setConnecting(true);
      pendingPaymentRef.current = { currency, recipientAddress, amount };

      try {
        // Reset any previous WalletConnect session so modal always starts fresh
        await resetAppKit();

        const kit = await initAppKit();
        if (!kit) {
          setError("Wallet service unavailable. Please try again.");
          setConnecting(false);
          return;
        }
        appkitRef.current = kit;

        // Check if already connected with an EVM address
        const addr = kit.getAddress?.();
        if (addr) {
          const state = kit.getState?.();
          const chain = state?.activeChain;
          const isSolana =
            chain === "solana" ||
            state?.selectedNetworkId?.startsWith("solana");
          if (!isSolana) {
            // Already connected to EVM, proceed to send
            setWalletAddress(addr);
            setWalletType("evm");
            setConnecting(false);
            await sendEvmPaymentDirect(currency, recipientAddress, amount);
            return;
          }
          // Connected to Solana via AppKit — disconnect and show EVM connect
          await kit.disconnect().catch(() => {});
        }

        // Open fresh wallet selection modal
        await kit.open({ view: "Connect" });
      } catch (e) {
        const msg = e.message || "Failed to open wallet modal";
        setError(msg.length > 120 ? msg.substring(0, 120) + "..." : msg);
      }
      setConnecting(false);
    },
    [],
  );

  // Called when AppKit detects a successful EVM connection
  const sendEvmPaymentDirect = async (currency, recipientAddress, amount) => {
    const info = CURRENCY_MAP[currency?.toLowerCase()];
    if (!info || info.type !== "evm") {
      setError("Invalid EVM currency");
      return;
    }

    setSending(true);
    try {
      const result = await sendEvmPayment(info, recipientAddress, amount);
      if (result) {
        setTxHash(result);
      }
    } catch (e) {
      if (
        e.code === 4001 ||
        e.code === "ACTION_REJECTED" ||
        e.message?.includes("rejected")
      ) {
        setError("Transaction rejected by user");
      } else {
        const msg = e.message || "Transaction failed";
        setError(msg.length > 120 ? msg.substring(0, 120) + "..." : msg);
      }
    }
    setSending(false);
  };

  /**
   * Main entry point — routes to SOL or EVM path based on currency type.
   * SOL → Phantom browser wallet directly
   * EVM → WalletConnect with fresh state
   * Others → manual transfer message
   */
  const connectAndSend = useCallback(
    async (currency, recipientAddress, amount) => {
      const info = CURRENCY_MAP[currency?.toLowerCase()];
      if (!info) {
        setError(
          "This currency requires manual transfer. Copy the address and send from your wallet.",
        );
        return null;
      }

      if (info.type === "solana") {
        return await connectAndSendSol(recipientAddress, amount);
      } else if (info.type === "evm") {
        return await connectAndSendEvm(currency, recipientAddress, amount);
      } else {
        setError("Unsupported currency type");
        return null;
      }
    },
    [connectAndSendSol, connectAndSendEvm],
  );

  const connectWallet = useCallback(async () => {
    setError("");
    setConnecting(true);
    try {
      await resetAppKit();
      const kit = await initAppKit();
      if (!kit) {
        setError("Wallet service unavailable. Please try again.");
        setConnecting(false);
        return;
      }
      appkitRef.current = kit;
      await kit.open({ view: "Connect" });
    } catch (e) {
      const msg = e.message || "Failed to open wallet modal";
      setError(msg.length > 120 ? msg.substring(0, 120) + "..." : msg);
    }
    setConnecting(false);
  }, []);

  // Listen for WalletConnect/AppKit connection events (EVM only)
  useEffect(() => {
    let unsubs = [];
    let interval = null;

    initAppKit().then((kit) => {
      if (!kit) return;
      appkitRef.current = kit;

      const detectConnection = () => {
        try {
          const addr = kit.getAddress?.();
          const state = kit.getState?.();
          const networkId = state?.selectedNetworkId;
          const chain = state?.activeChain;
          if (addr && networkId) {
            const isSolana =
              chain === "solana" || networkId.startsWith("solana");
            if (!isSolana) {
              setWalletAddress(addr);
              setWalletType("evm");
              setConnecting(false);

              // If there's a pending EVM payment, execute it
              const pending = pendingPaymentRef.current;
              if (pending) {
                pendingPaymentRef.current = null;
                sendEvmPaymentDirect(
                  pending.currency,
                  pending.recipientAddress,
                  pending.amount,
                );
              }
            }
          }
        } catch {}
      };

      try {
        const u1 = kit.subscribeEvents?.((event) => {
          const name = event?.data?.event;
          if (name === "CONNECT_SUCCESS") {
            setTimeout(detectConnection, 500);
          }
        });
        if (typeof u1 === "function") unsubs.push(u1);
      } catch {}

      try {
        const u2 = kit.subscribeState?.((state) => {
          if (state?.open === false && !walletAddress) {
            setTimeout(detectConnection, 200);
          }
        });
        if (typeof u2 === "function") unsubs.push(u2);
      } catch {}

      interval = setInterval(detectConnection, 2000);
    });

    return () => {
      if (interval) clearInterval(interval);
      unsubs.forEach((u) => {
        try {
          u();
        } catch {}
      });
    };
  }, []);

  const sendPayment = useCallback(
    async (currency, recipientAddress, amount) => {
      setError("");
      setTxHash("");
      if (!recipientAddress || !amount || parseFloat(amount) <= 0) {
        setError("Invalid payment details");
        return null;
      }

      const info = CURRENCY_MAP[currency?.toLowerCase()];
      if (!info) {
        setError(
          "This currency requires manual transfer. Copy the address and send from your wallet.",
        );
        return null;
      }

      setSending(true);
      try {
        if (info.type === "evm") {
          return await sendEvmPayment(info, recipientAddress, amount);
        } else if (info.type === "solana") {
          return await sendSolanaPayment(info, recipientAddress, amount);
        }
      } catch (e) {
        if (
          e.code === 4001 ||
          e.code === "ACTION_REJECTED" ||
          e.message?.includes("rejected")
        ) {
          setError("Transaction rejected by user");
        } else {
          const msg = e.message || "Transaction failed";
          setError(msg.length > 120 ? msg.substring(0, 120) + "..." : msg);
        }
      }
      setSending(false);
      return null;
    },
    [walletAddress],
  );

  const getEvmWalletProvider = () => {
    const kit = appkitRef.current;
    if (kit) {
      try {
        const eip155Provider = kit.getProvider?.("eip155");
        if (eip155Provider?.request) return eip155Provider;
      } catch {}
      try {
        const wp = kit.getWalletProvider?.();
        if (wp?.request && typeof wp.request === "function") {
          try {
            if (!wp.signAndSendTransaction) return wp;
          } catch {}
        }
      } catch {}
    }
    return getEvmProvider();
  };

  const sendEvmPayment = async (info, recipientAddress, amount) => {
    const chainId = EVM_CHAIN_IDS[info.chain];
    if (!chainId) {
      setError("Unsupported EVM network");
      setSending(false);
      return null;
    }

    const provider = getEvmWalletProvider();
    if (!provider) {
      setError(
        "No EVM wallet found. Please connect an EVM-compatible wallet (MetaMask, Coinbase, etc.)",
      );
      setSending(false);
      return null;
    }

    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x" + chainId.toString(16) }],
      });
    } catch (switchErr) {
      if (switchErr.code === 4902) {
        setError("Please add this network to your wallet");
        setSending(false);
        return null;
      }
      throw switchErr;
    }

    const accounts = await provider.request({ method: "eth_requestAccounts" });
    const from = accounts?.[0];
    if (!from) {
      setError("Could not get EVM address. Please connect an EVM wallet.");
      setSending(false);
      return null;
    }
    const { ethers } = await import("ethers");

    if (info.native) {
      const weiValue = ethers.parseEther(String(amount));
      const hash = await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from,
            to: recipientAddress,
            value: "0x" + weiValue.toString(16),
          },
        ],
      });
      setTxHash(hash);
      setSending(false);
      return hash;
    } else {
      const browserProvider = new ethers.BrowserProvider(provider);
      const signer = await browserProvider.getSigner();
      const tokenAmount = ethers.parseUnits(String(amount), info.decimals);
      const erc20Abi = [
        "function transfer(address to, uint256 amount) returns (bool)",
      ];
      const contract = new ethers.Contract(info.contract, erc20Abi, signer);
      const tx = await contract.transfer(recipientAddress, tokenAmount);
      setTxHash(tx.hash);
      setSending(false);
      return tx.hash;
    }
  };

  const sendSolanaPayment = async (info, recipientAddress, amount) => {
    if (!info.native) {
      setError(
        "SPL token transfers not supported via wallet. Please copy the address and send manually.",
      );
      setSending(false);
      return null;
    }

    // Use Phantom browser wallet directly
    const phantom = getPhantomProvider();
    if (!phantom) {
      setError(
        "Phantom wallet not found. Please install Phantom browser extension.",
      );
      setSending(false);
      return null;
    }

    if (!phantom.isConnected) {
      await phantom.connect();
    }

    const {
      Connection,
      PublicKey,
      Transaction,
      SystemProgram,
      LAMPORTS_PER_SOL,
    } = await import("@solana/web3.js");

    const rpcUrl =
      import.meta.env.VITE_SOLANA_RPC_URL ||
      "https://api.mainnet-beta.solana.com";
    const connection = new Connection(rpcUrl, "confirmed");

    const fromPubkey = phantom.publicKey;
    const toPubkey = new PublicKey(recipientAddress);
    const lamports = Math.round(parseFloat(amount) * LAMPORTS_PER_SOL);

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey,
        toPubkey,
        lamports,
      }),
    );

    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = fromPubkey;

    const signed = await phantom.signAndSendTransaction(transaction);
    const signature = signed.signature || signed;
    setTxHash(typeof signature === "string" ? signature : signature.toString());
    setSending(false);
    return signature;
  };

  const getBalanceAndGas = useCallback(
    async (currency, recipientAddress, amount) => {
      try {
        const info = CURRENCY_MAP[currency?.toLowerCase()];
        if (!info) return null;

        if (info.type === "evm") {
          const provider = getEvmWalletProvider();
          if (!provider || !walletAddress) return null;

          const { ethers } = await import("ethers");
          const browserProvider = new ethers.BrowserProvider(provider);

          const nativeBalanceWei =
            await browserProvider.getBalance(walletAddress);
          const nativeBalance = parseFloat(
            ethers.formatEther(nativeBalanceWei),
          );

          let tokenBalance = null;
          let estimatedGas = null;

          if (!info.native && info.contract) {
            const erc20Abi = [
              "function balanceOf(address) view returns (uint256)",
              "function transfer(address to, uint256 amount) returns (bool)",
            ];
            const contract = new ethers.Contract(
              info.contract,
              erc20Abi,
              browserProvider,
            );
            const rawBal = await contract.balanceOf(walletAddress);
            tokenBalance = parseFloat(
              ethers.formatUnits(rawBal, info.decimals),
            );
          } else {
            tokenBalance = nativeBalance;
          }

          return {
            nativeBalance,
            tokenBalance,
            estimatedGas,
            isNative: info.native,
          };
        }

        if (info.type === "solana") {
          const { Connection, PublicKey, LAMPORTS_PER_SOL } = await import(
            "@solana/web3.js"
          );
          const rpcUrl =
            import.meta.env.VITE_SOLANA_RPC_URL ||
            "https://api.mainnet-beta.solana.com";
          const connection = new Connection(rpcUrl, "confirmed");
          // Use Phantom's public key for balance
          const phantom = getPhantomProvider();
          const addr = walletAddress || phantom?.publicKey?.toBase58();
          if (!addr) return null;
          const balance = await connection.getBalance(new PublicKey(addr));
          return {
            nativeBalance: balance / LAMPORTS_PER_SOL,
            tokenBalance: balance / LAMPORTS_PER_SOL,
            estimatedGas: null,
            isNative: true,
          };
        }

        return null;
      } catch (e) {
        console.warn("[CryptoWallet] getBalanceAndGas error:", e.message);
        return null;
      }
    },
    [walletAddress],
  );

  return {
    walletAddress,
    walletType,
    connecting,
    sending,
    error,
    txHash,
    hasWallet:
      typeof window !== "undefined" && !!(window.ethereum || window.solana),
    connectWallet,
    connectAndSend,
    connectAndSendSol,
    connectAndSendEvm,
    resetState,
    sendPayment,
    getBalanceAndGas,
    setError,
    setWalletAddress,
    setWalletType,
    isPhantomInstalled: isPhantomInstalled(),
  };
}
