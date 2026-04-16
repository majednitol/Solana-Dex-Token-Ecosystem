import { useState, useMemo } from "react";
import { useTokenList } from "../stores/useTokenListStore";
import { useTokenPrice } from "../stores/useTokenPriceStore";
import {
  Coins,
  ArrowLeftRight,
  BarChart3,
  Home,
  Rocket,
  WalletCards,
  Lock,
  HelpCircle,
  ScrollText,
} from "lucide-react";

function buildSections(ntcToken) {
  return [
    {
      id: "overview",
      title: "Platform Overview",
      icon: <Home size={16} />,
      content: [
        {
          heading: "What is Cryptonite Swap?",
          text: "Cryptonite Swap is a decentralized token exchange built on the Solana blockchain. It enables instant swaps between Nite Coin (NTC) and 9 digital currency tokens, each representing a real-world fiat currency. All swaps are routed through NTC as the base pair, ensuring deep liquidity and consistent pricing.",
        },
        {
          heading: "Key Features",
          list: [
            "Instant token swaps with real-time price calculations",
            "Low transaction fees (0.3% per swap)",
            "Configurable slippage tolerance (0.1% – 50%)",
            "Solana wallet integration (Phantom & Solflare)",
            "Live market data and interactive price charts",
            "Portfolio tracking with estimated token values",
          ],
        },
      ],
    },
    {
      id: "getting-started",
      title: "Getting Started",
      icon: <Rocket size={16} />,
      content: [
        {
          heading: "1. Connect Your Wallet",
          text: 'Click the "Select Wallet" button in the top-right corner to connect a Solana wallet. Cryptonite Swap supports Phantom and Solflare wallets. If you don\'t have one installed, the wallet selection dialog will provide a direct link to install it.',
        },
        {
          heading: "2. Select Tokens",
          text: "On the Swap page, choose the token you want to sell from the dropdown. The buy side will automatically be set to NTC (Nite Coin), or vice versa. All token pairs are traded against NTC as the base currency.",
        },
        {
          heading: "3. Enter Amount & Review",
          text: "Enter the amount you want to swap. The interface will show you the estimated output amount, price impact, minimum received (accounting for slippage), fees, and the exchange rate. Review these details before confirming.",
        },
        {
          heading: "4. Execute the Swap",
          text: 'Once you\'re satisfied with the swap details, click the "Swap" button to submit the transaction. The swap will be processed on the Solana blockchain and your balances will update automatically.',
        },
      ],
    },
    {
      id: "tokens",
      title: "Token Directory",
      icon: <Coins size={16} />,
      content: [
        {
          heading: "Base Currency",
          text: `${ntcToken.fullName} (${ntcToken.symbol}) is the base trading pair for all swaps on Cryptonite Swap. Every token is traded against NTC. It serves as the central liquidity hub of the platform.`,
        },
        {
          heading: "Supported Tokens",
          tokenTable: true,
        },
      ],
    },
    {
      id: "swapping",
      title: "How Swaps Work",
      icon: <ArrowLeftRight size={16} />,
      content: [
        {
          heading: "Swap Mechanics",
          text: "Every swap on Cryptonite is routed through NTC as the base pair. When you swap Token A for Token B, the system executes two legs: Token A → NTC, then NTC → Token B. This ensures consistent liquidity across all pairs.",
        },
        {
          heading: "Price Calculation",
          text: "Swap prices are determined by the current market rate of each token relative to NTC. The exchange rate is calculated as: Output Amount = (Input Amount × Sell Token Price) ÷ Buy Token Price.",
        },
        {
          heading: "Slippage Tolerance",
          text: "Slippage is the difference between the expected price and the actual execution price. You can configure your slippage tolerance using the gear icon (⚙) on the swap page. The default is 0.5%. Higher slippage tolerance means your transaction is more likely to succeed during volatile markets, but you may receive less favorable pricing.",
        },
        {
          heading: "Fees",
          text: "Cryptonite Swap charges a flat 0.3% fee on each swap. This fee is calculated on the sell amount and is displayed in the swap details panel before you confirm. Additionally, Solana network fees (~$0.0025) apply to each transaction.",
        },
        {
          heading: "Minimum Received",
          text: 'The "Min. received" value shown in swap details represents the worst-case output amount after accounting for your slippage tolerance. Formula: Min Received = Expected Output × (1 - Slippage %).',
        },
      ],
    },
    {
      id: "wallets",
      title: "Wallet Guide",
      icon: <WalletCards size={16} />,
      content: [
        {
          heading: "Supported Wallets",
          list: [
            "Phantom — The most popular Solana wallet, available as a browser extension and mobile app. Download at phantom.app.",
            "Solflare — A feature-rich Solana wallet with staking support. Download at solflare.com.",
          ],
        },
        {
          heading: "Connecting Your Wallet",
          text: 'Click "Select Wallet" in the navigation bar. A modal will appear showing available wallets. Wallets that are installed in your browser will show a "Detected" badge. Click on a wallet to initiate the connection. You\'ll need to approve the connection in your wallet extension.',
        },
        {
          heading: "Viewing Your Balance",
          text: "Once connected, your SOL balance is displayed in the top navigation bar. Navigate to the Assets page to see your full token portfolio with estimated values and portfolio percentages.",
        },
        {
          heading: "Disconnecting",
          text: 'Click on your wallet address in the navigation bar to open the dropdown menu, then select "Disconnect" to safely disconnect your wallet from the platform.',
        },
      ],
    },
    {
      id: "market-data",
      title: "Market Data",
      icon: <BarChart3 size={16} />,
      content: [
        {
          heading: "Markets Page",
          text: "The Markets page shows a comprehensive view of all supported tokens with their current price, 24-hour change percentage, market cap, and 24-hour trading volume. Click on any token row to view detailed price charts.",
        },
        {
          heading: "Price Charts",
          text: "Interactive area charts are available for each token with multiple timeframe options: 24 Hours, 7 Days, 1 Month, 3 Months, 1 Year, and All Time. Charts show price movement with gradient fills and display key statistics including all-time high, all-time low, and circulating supply.",
        },
        {
          heading: "Market Analysis",
          text: "The top section of the Markets page highlights the 3 best-performing tokens by 24-hour price change, along with volume comparison charts to help identify trending tokens.",
        },
      ],
    },
    {
      id: "security",
      title: "Security",
      icon: <Lock size={16} />,
      content: [
        {
          heading: "Non-Custodial",
          text: "Cryptonite Swap is a non-custodial platform. Your private keys never leave your wallet. We do not store, access, or control your funds at any time. All swaps are executed directly on the Solana blockchain.",
        },
        {
          heading: "Smart Contract Security",
          text: "All swap operations are handled through audited smart contracts on Solana. Transactions are transparent and verifiable on the Solana blockchain explorer.",
        },
        {
          heading: "Best Practices",
          list: [
            "Never share your seed phrase or private keys with anyone",
            "Always verify the URL before connecting your wallet",
            "Start with small swap amounts to test the process",
            "Review all swap details (rate, fees, slippage) before confirming",
            "Disconnect your wallet when you're done using the platform",
          ],
        },
      ],
    },
    {
      id: "faq",
      title: "FAQ",
      icon: <HelpCircle size={16} />,
      content: [
        {
          heading: "Why can I only swap against NTC?",
          text: "All tokens on Cryptonite Swap are paired with NTC (Nite Coin) as the base currency. This design simplifies liquidity management and ensures consistent pricing. To swap between two non-NTC tokens, the system automatically routes through NTC.",
        },
        {
          heading: "What is the swap fee?",
          text: "A flat 0.3% fee is charged on every swap. This fee is shown in the swap details before you confirm the transaction.",
        },
        {
          heading: "What happens if my transaction fails?",
          text: "If a transaction fails (usually due to network congestion or insufficient slippage tolerance), no funds are deducted from your wallet except for a small Solana network fee. Try increasing your slippage tolerance or waiting a moment before retrying.",
        },
        {
          heading: "How do I see my token balances?",
          text: 'Navigate to the Assets page from the sidebar. It displays all your token holdings with current prices, estimated values, and portfolio allocation percentages. You can also click "Swap" next to any token to quickly navigate to the swap page with that token pre-selected.',
        },
        {
          heading: "Which blockchain does Cryptonite Swap use?",
          text: "Cryptonite Swap is built on Solana, known for its fast transaction speeds and low fees. All swaps settle on-chain within seconds.",
        },
      ],
    },
    {
      id: "terms",
      title: "CRYPTONITE SWAP & TERMS OF SERVICE",
      icon: <ScrollText size={16} />,
      content: [
        {
          heading: "About Cryptonite Swap & Terms of Service",
          text: 'Effective Date: [01:05:2026]\n\nThese Terms of Service (the "Agreement") constitute a legally binding agreement between User and Bridgehouse Labs (B.U.C.C.I) governing your access to and use of Cryptonite Swap and all associated products, services, interfaces, and applications (collectively, the "Products").\n\nBy accessing or using any of the Products, you acknowledge that you have read, understood, and agree to be bound by this Agreement in its entirety. If you do not agree to these terms, you must not access or use the Products.',
        },
        {
          heading: "1. Eligibility and Legal Capacity",
          text: "In order to access or use the Products, you must have the legal capacity to enter into a binding agreement under the laws of your jurisdiction. By using the Products, you represent and warrant that you have reached the age of majority in your jurisdiction and possess the full right, power, and authority to enter into and comply with the terms of this Agreement. Where you access or use the Products on behalf of a legal entity, you further represent that you are duly authorized to bind such entity to this Agreement, and that such entity accepts full responsibility for your actions.\n\nYou further represent that you are not subject to any sanctions or restrictions imposed by any governmental authority, nor are you located in, organized in, or a resident of any jurisdiction that is subject to comprehensive economic or trade sanctions. You agree that your use of the Products will at all times comply with all applicable laws, regulations, and legal obligations.",
        },
        {
          heading: "2. Sovereign Participation and Assumption of Responsibility",
          text: "You expressly acknowledge and agree that your participation in Cryptonite Swap is undertaken as a sovereign individual, acting independently and on your own behalf, and not in reliance on Bridgehouse Labs or any third party for financial, legal, or technical guidance, but rather in reliance on your own active learning, risk assessments, and personal due diligence. You understand and accept that the use of decentralized technologies requires a high degree of personal responsibility, technical awareness, and continuous vigilance.\n\nBy using the Products, you affirm that you possess sufficient knowledge and experience to understand the functionality, risks, and mechanics of blockchain-based systems and digital assets. You acknowledge that all transactions executed through the Products occur on the Solana blockchain, which operates in a decentralized and permissionless manner, and that such transactions are final and irreversible once confirmed. Any errors in transaction execution, including but not limited to incorrect wallet addresses, unintended approvals, or interactions with malicious smart contracts, may result in the permanent and unrecoverable loss of digital assets.\n\nYou further acknowledge that the security of your assets is entirely your responsibility. This includes, without limitation, the proper management and safeguarding of private keys, seed phrases, and wallet credentials, as well as the verification of transaction details and the legitimacy of counterparties and interfaces. You accept that failures in personal security practices, exposure to phishing or social engineering attacks, or the use of compromised devices may result in unauthorized access and loss of assets.\n\nBridgehouse Labs does not custody user assets, does not have access to private keys, and does not possess the ability to reverse transactions or recover lost funds. Accordingly, you assume full responsibility and liability for all actions taken through your use of the Products and for any resulting losses.",
        },
        {
          heading: "3. Description of Services",
          text: "Cryptonite Swap provides a non-custodial interface that enables users to interact with decentralized smart contracts deployed on the Solana blockchain for the purpose of digital asset exchange and related functionalities. The Products serve solely as a user interface and access point and do not themselves execute transactions, hold funds, or act as an intermediary in the custody or transfer of digital assets.\n\nYou acknowledge that the underlying protocol operates autonomously through smart contracts and decentralized infrastructure. Bridgehouse Labs does not control the Solana network, validator operations, or the execution of transactions once submitted. As such, the performance, availability, and reliability of the Products may be affected by factors outside of our control, including network congestion, outages, or protocol-level vulnerabilities.",
        },
        {
          heading: "4. Treasury-Controlled Liquidity and Infrastructure Design",
          text: "Cryptonite Swap operates under a protocol-controlled liquidity model in which liquidity is supplied exclusively by a treasury associated with Bridgehouse Labs and embedded as a foundational component of the protocol's infrastructure. Unlike traditional decentralized exchanges that rely on external liquidity providers, Cryptonite Swap does not permit or rely upon user-supplied liquidity pools.\n\nYou acknowledge and understand that all liquidity pools within the protocol are structured as permanently locked infrastructure components, designed to provide baseline market functionality and continuity. These pools are not subject to user withdrawal and are intended to function as a stable and enduring layer of the protocol's operational design.\n\nNotwithstanding the foregoing, you further acknowledge that the existence of locked liquidity does not eliminate risk. Market conditions, asset volatility, treasury allocation strategies, and systemic factors may influence pricing, depth, and execution quality. While the infrastructure is designed to support continuity and value integrity, Bridgehouse Labs makes no representation or warranty regarding price stability, market efficiency, or protection against loss.\n\nYou accept that interaction with such liquidity infrastructure remains subject to the inherent risks of blockchain systems, including slippage, volatility, and smart contract behavior.",
        },
        {
          heading: "5. Third-Party Services",
          text: "The Products may provide access to or integration with third-party services, applications, or resources. Such Third-Party Services are not owned or controlled by Bridgehouse Labs, and we make no representations regarding their accuracy, reliability, or security.\n\nYour use of any Third-Party Services is undertaken entirely at your own risk and subject to the terms and conditions imposed by those third parties. Bridgehouse Labs shall not be responsible for any loss or damage arising from your use of or reliance on Third-Party Services.",
        },
        {
          heading: "6. Modifications",
          text: "Bridgehouse Labs reserves the right to modify or update this Agreement at any time in its sole discretion. Any such modifications shall become effective upon posting. Your continued use of the Products following any changes constitutes your acceptance of the revised Agreement.\n\nWe further reserve the right to modify, suspend, or discontinue any aspect of the Products at any time without prior notice or liability.",
        },
        {
          heading: "7. Intellectual Property Rights",
          text: "All intellectual property rights in and to the Products, including but not limited to software, code, design, trademarks, and content, are owned by Bridgehouse Labs or its licensors. Subject to this Agreement, you are granted a limited, non-exclusive, non-transferable, and revocable license to access and use the Products solely for their intended purposes.\n\nYou agree not to reproduce, distribute, modify, reverse engineer, or otherwise exploit any portion of the Products except as expressly permitted by this Agreement.",
        },
        {
          heading: "8. User Obligations and Prohibited Conduct",
          text: "You agree that you will not engage in any conduct that violates applicable laws or infringes upon the rights of others in connection with your use of the Products. This includes, without limitation, engaging in fraudulent activity, market manipulation, unauthorized access to systems, or the use of illicitly obtained funds.\n\nYou further agree not to interfere with the operation, integrity, or security of the Products, nor to attempt to exploit any vulnerabilities or weaknesses in the system.",
        },
        {
          heading: "9. Non-Custodial Nature and No Fiduciary Duties",
          text: "The Products are strictly non-custodial in nature, meaning that Bridgehouse Labs does not at any time have custody, possession, or control over your digital assets. You retain exclusive control over your assets and the associated private keys.\n\nTo the fullest extent permitted by law, Bridgehouse Labs disclaims any fiduciary duties or obligations to you. Nothing in this Agreement shall be construed as creating any relationship of trust, agency, or fiduciary responsibility.",
        },
        {
          heading: "10. Fees and Transactions",
          text: "All transactions conducted through the Products are executed on the Solana blockchain and require the payment of network fees. You are solely responsible for such fees, as well as for ensuring the accuracy and validity of all transactions you initiate.\n\nBridgehouse Labs does not guarantee that transactions will be executed successfully or within any particular timeframe.",
        },
        {
          heading: "11. Compliance and Tax Obligations",
          text: "You are solely responsible for determining and fulfilling any legal or regulatory obligations applicable to your use of the Products, including but not limited to tax reporting and payment obligations arising from your transactions.",
        },
        {
          heading: "12. Disclaimers",
          text: 'The Products are provided on an "AS IS" and "AS AVAILABLE" basis without warranties of any kind. To the fullest extent permitted by law, Bridgehouse Labs disclaims all representations and warranties, whether express or implied, including any warranties of merchantability, fitness for a particular purpose, or non-infringement.\n\nYou acknowledge that the use of blockchain-based systems involves inherent risks, including but not limited to volatility, technical failures, and security vulnerabilities, and you accept full responsibility for such risks.',
        },
        {
          heading: "13. Indemnification",
          text: "You agree to indemnify, defend, and hold harmless Bridgehouse Labs and its affiliates from any claims, damages, or liabilities arising out of or related to your use of the Products or your violation of this Agreement.",
        },
        {
          heading: "14. Limitation of Liability",
          text: "To the fullest extent permitted by law, Bridgehouse Labs shall not be liable for any indirect, incidental, consequential, or punitive damages arising out of or related to your use of the Products. In no event shall our total liability exceed one hundred U.S. dollars (USD $100).",
        },
        {
          heading: "15. Governing Law and Dispute Resolution",
          text: "This Agreement shall be governed by the laws of the Netherlands. Any disputes arising under or in connection with this Agreement shall be resolved through binding arbitration conducted in the Netherlands, and you agree to waive any right to participate in class or collective actions.",
        },
        {
          heading: "16. General Provisions",
          text: "This Agreement constitutes the entire agreement between you and Bridgehouse Labs regarding the Products. If any provision is found to be unenforceable, the remaining provisions shall remain in full force and effect. The failure to enforce any right or provision shall not constitute a waiver of such right.",
        },
        {
          heading: "Final Acknowledgment",
          text: "By accessing or using Cryptonite Swap, you acknowledge that you are acting as a sovereign individual, that you fully understand the risks associated with blockchain technology and digital assets, and that you accept full responsibility for your actions and any resulting outcomes, including the potential for total financial loss.",
        },
        {
          heading: "CRYPTONITE DECENTRALISED FINANCIAL CAPITAL — Abstract",
          text: "Cryptonite Decentralised Financial Capital (C.D.F.C) is a decentralized, neutral market infrastructure designed to operate alongside the fiat foreign exchange (FX) system to address the structural limitations inherent in contemporary fiat market structure. The protocol establishes permissionless settlement rails through which independent, supply-constrained utility digital currency representations of fiat currencies function as both stores of value and instruments of settlement, without reliance on debt issuance, custodial pegs, or centralized monetary authority.\n\nThe protocol intentionally separates the act of exchange from the mechanisms of money creation. By externalizing issuance from settlement, Cryptonite Swap serves as the interactive rails that facilitates capital mobility and market-driven price discovery, while avoiding the introduction of systemic leverage, credit expansion, or balance-sheet risk within the settlement layer.",
        },
        {
          heading: "Global Monetary Context",
          text: "Global currency markets represent one of the largest and most systemically important infrastructures in the world economy. Trillions in value are exchanged daily across sovereign and institutional corridors, underpinning trade, capital allocation, and reserve management.\n\nHowever, modern foreign exchange (FX) architecture remains structurally dependent on centralized issuance, sovereign debt expansion, custodial settlement chains, correspondent banking networks, and layered counterparty exposure. While these mechanisms have enabled global scale, they inherently introduce fragility, opacity, political dependency and reflexive leverage into the core of monetary exchange.\n\nThe U.S. dollar has served as the world's primary reserve currency for decades, underpinning global trade and financial systems. However, its dominant position has been increasingly undermined by the overextension of its influence. The widespread use of sanctions as a political tool and the unchecked expansion of the dollar supply have eroded global trust. In recent years, escalating trade conflicts with multiple nations have further strained the dollar's credibility as a neutral medium for international exchange. Compounding this is the United States' massive and ever-growing national debt reaching into the tens of trillions which raises serious concerns about long-term fiscal sustainability since the debt seems impossible to pay back which signifies an inevitable default and a crash in the dollar. Should the dollar lose its ability to uphold its obligations or face a default, the absence of a viable global alternative could trigger severe disruption across international markets, potentially crippling trade networks and destabilizing economies worldwide.",
        },
        {
          heading: "What is Money",
          text: "Today money has certainly evolved and is now best defined as a system of precise representation, accurate account and tokenization of value that must be widely accepted, easily accessible, uniquely identifiable, durable and divisible to function effectively within an economy as Token of value for exchange.",
          list: [
            "Money can take many forms of assets that uniquely represent value but throughout history, gold and especially silver have most reliably met the conditions to function as money. However, in today's world of high-speed international trade, money is no longer just a store of value, it's a system & physical assets like gold and silver are no longer practical for settlement. Moving them quickly and securely across borders, accounting and ensuring validity of reserves are inefficient and slow, creating friction in the global economy that will either slow it down or lead to inflation and eventual collapse.",
            "As a workaround, centralized systems like the Federal Reserve were created to hold reserves in one place and facilitate global settlements. But this model proved vulnerable to misuse particularly by the U.S. government leading to the abandonment of the gold standard and the rise of the current fiat currency system, which is no longer backed by any physical asset other than government promise and economic generated demand.",
            "Bitcoin is a digital asset that stores value by recording transactions on an immutable ledger. Its token acts as the medium that facilitates the exchange of value. To illustrate: if Bitcoin were replaced with gold as a reserve asset, both would serve the same purpose of storing and representing value but in different forms. Gold like other physical assets store value by being the object of value themselves while digital assets like bitcoin store value through the ledger record of ownership cryptographically represented in digital unique tokens.",
          ],
        },
        {
          heading: "What is Central Bank Digital Currency (C.B.D.C)",
          text: "It's important to understand that most central banks, while appearing to function as public institutions, often operate as private entities and are influenced by private interests. These institutions hold immense power over the economy, by controlling the issuance of a country's legal tender and shaping its monetary policy. The overall health of an economy, whether strong or struggling, is heavily impacted by the actions of both the government and, more critically, the central bank. Through continuous expansion of the money supply and funneling of these currencies into assets central banks contribute to the gradual erosion of currency value over time, leading to persistent inflation that diminishes purchasing power across generations while empowering few.\n\nC.B.D.C is a programmed digital form of fiat currency issued and regulated by its central bank. As a currency, the C.B.D.C (Central Bank Digital Currency) introduces no fundamental improvements that make it a more reliable store of value. While it may be digitized, it remains a fiat currency subject to the same central banking policies that enable inflation, corporate bailouts, recessions, and systemic financial instability. In essence, C.B.D.Cs retain the core vulnerabilities of traditional fiat systems only with enhanced surveillance and control capabilities.\n\nThe Cryptonite Decentralised Financial Capital (C.D.F.C) protocol does not seek to replace fiat currencies, sovereign systems or existing FX infrastructure. Instead, it introduces a parallel, neutral settlement layer as a structurally independent coordination framework that enables value exchange without requiring trust in issuers, custodians, discretionary monetary authorities or centralized clearing intermediaries.\n\nC.D.F.C is engineered to be neutral at the protocol layer, irreversible at the liquidity layer and resistant to systemic leverage expansion.",
        },
        {
          heading: "Cryptonite Swap: The Primary Exchange Layer",
          text: "Cryptonite Swap is the primary expression and interaction layer of the C.D.F.C protocol. It is the mechanism through which value coordination occurs and liquidity is structurally committed.\n\nRather than functioning as a conventional decentralised exchange that merely facilitates token swaps, Cryptonite Swap serves as a settlement geometry engine and liquidity architecture where treasury committed capital is part of a permanent structural framework supporting price discovery and exchange continuity.\n\nThe design of Cryptonite Swap prioritizes structural stability, transactional velocity, utility and systemic neutrality over competitive issuance and governance policy dynamics. It is not built around synthetic pegs, algorithmic monetary expansion or leverage amplification mechanisms. Instead, it creates a bounded exchange environment where pricing emerges organically from liquidity topology and participant interaction.\n\nLiquidity in Cryptonite Swap is not speculative, it is structural capital committed indefinitely as an irreversible component of the protocol's exchange architecture, reinforcing long-term stability and credible settlement guarantees.",
        },
        {
          heading: "Positioning and Scope",
          text: "Cryptonite Swap is not:",
          list: [
            "A stablecoin",
            "A bank",
            "A lending protocol",
            "A CBDC",
          ],
        },
        {
          heading: "Positioning and Scope (continued)",
          text: "It is a neutral permissionless monetary settlement infrastructure designed for long-term coexistence with existing financial systems. Cryptonite Swap introduces a new class of monetary infrastructure where trust emerges from structural integrity and transparent market structure. By separating exchange from supply and eliminating custodial dependencies, the protocol offers a resilient parallel settlement layer suited to a multipolar and increasingly fragmented global economy.",
        },
        {
          heading: "Core Design Principles",
          text: "Cryptonite Swap, as the operational interface of CDFC, is constructed on the following foundational principles:",
          list: [
            "Neutrality — The protocol does not privilege any sovereign currency, institution, asset class, or participant. No embedded bias toward specific monetary systems exists within the architecture. All exchange relationships are algorithmically symmetrical.",
            "Irreversibility — Liquidity committed by the treasury to the system is permanently locked at the structural layer. This creates credible, long-duration settlement guarantees, value security and eliminates withdrawal reflexivity that destabilizes conventional liquidity pools. Structural permanence reinforces systemic resilience.",
            "Separation of Exchange and Issuance — Exchange mechanisms are isolated from money creation functions. The protocol does not algorithmically mint liquidity to sustain pricing, nor does it entangle issuance with trading mechanics. This separation prevents reflexive leverage cycles and monetary inflation within the exchange layer.",
            "Permissionless Access — Participation does not require institutional approval, custodial relationships or jurisdictional alignment. Any participant can coordinate value through the protocol without geopolitical restrictions and reliance on centralized intermediaries.",
            "Market Derived Pricing — Prices emerge from liquidity geometry, depth relationships and real usage activity, not from artificial pegs, discretionary monetary policy or governance driven price stabilization efforts. It is a system in continuous flow and this ensures that valuation reflects structural participation rather than policy intervention.",
            "Leverage Resistance — The architecture is designed to limit endogenous leverage expansion. By preventing recursive liquidity extraction and synthetic yield amplification the system reduces systemic fragility common in traditional and decentralised finance environments.",
          ],
        },
        {
          heading: "Structural Positioning",
          text: "Cryptonite Swap should be understood not as a speculative trading venue but as a coordination neutral liquidity infrastructure enabling non-custodial exchange within a structurally bounded system.",
          list: [
            "Where traditional FX systems rely on institutional trust hierarchies, Cryptonite swap relies on structural irreversibility.",
            "Where centralized exchanges rely on custody, Cryptonite Swap relies on protocol determinism.",
            "Where monetary systems rely on policy discretion, Cryptonite Swap relies on transparent liquidity mechanics.",
          ],
        },
        {
          heading: "Structural Positioning (continued)",
          text: "Together, the CDFC blockchain and Cryptonite Swap establish a parallel digital financial capital framework designed for durability, value security, neutrality, and systemic resilience especially against manipulation.",
        },
        {
          heading: "System Architecture Overview",
          text: "Cryptonite Swap base layer consists of three primary components:",
          list: [
            "Network Token Coin (NTC): A neutral settlement and routing asset.",
            "Reference DCs: Independent, supply-constrained digital currency representations referencing external fiat currencies.",
            "Permanent Liquidity Pools: Irreversibly locked AMM pools connecting TokenDCs to NTC.",
          ],
        },
        {
          heading: "System Architecture Overview (continued)",
          text: "This hub-and-spoke architecture ensures that all currency exchange occurs through a common neutral medium, enabling coherent pricing across the network.",
        },
        {
          heading: "Cryptonite Digital Currency: Nite Treasury Currency (NTC)",
          text: "Nite Coin(NTC) is a price-floored digital currency: a non-pegged, market-priced digital asset that incorporates protocol-defined mechanisms to bound downside risk while preserving open price discovery above the floor. NTC functions as the system's central settlement asset and serves a purely infrastructural role. It does not represent a claim on external assets, does not provide fiat or asset redemption rights, and does not confer ownership, yield or entitlement beyond its use within the protocol which are.",
          list: [
            "Providing a neutral unit of account for cross-currency exchange",
            "Serving as the routing asset between all ReferenceDCs",
            "Anchoring the liquidity geometry of the network",
          ],
        },
        {
          heading: "Cryptonite Digital Currency: Nite Treasury Currency (NTC) (continued)",
          text: "NTC supply is fixed and known, eliminating issuance discretion and monetary expansion risk.",
        },
        {
          heading: "Reference Digital Currency Representations",
          text: "ReferenceDCs are supply-constrained, capital utility fiat-referenced digital currencies introduced with a nominal fiat reference value (e.g., USD, EUR, GBP), whose price subsequently emerges through open market dynamics. They serve as purely infrastructural settlement assets and do not confer redeemability, custodial backing or claims on external assets. Instead, their value is established and maintained through permanently locked liquidity against NTC, demand and adoption ensuring price formation is market-driven while supporting system-level settlement and utilities.\n\nKey properties:",
          list: [
            "Fixed supply & demand constrained issuance.",
            "No redemption promises",
            "No reliance on off-chain custody",
            "Value coherence maintained through exchange geometry",
            "Permissionless settlement rails.",
          ],
        },
        {
          heading: "Permanent Liquidity Protocol Model",
          text: "The Permanent Liquidity Protocol Model is a mechanism in which the treasury adds liquidity to a pool once and permanently locked, typically by burning the LP (liquidity provider) tokens that would otherwise grant withdrawal rights. This ensures that the liquidity backing the market cannot be withdrawn, manipulated or controlled by any party, including governance or protocol operators.\n\nExpanded Context:",
          list: [
            "Network Reliability: Because liquidity cannot be removed, pools serve as permanent infrastructure for the network, guaranteeing that exchanges remain available indefinitely.",
            "Trust Minimization: Users do not need to rely on promises from the governance bodies or external custodians; trust is derived from immutability and on-chain enforcement.",
            "System Stability: Permanent liquidity reduces systemic risk by ensuring that critical pools cannot suddenly vanish, preventing liquidity crises and sudden price shocks.",
            "Treasury Alignment: Treasury commits resources permanently, aligning incentives with long-term network success rather than short-term profit extraction.",
          ],
        },
        {
          heading: "Permanent Liquidity Protocol Model (continued)",
          text: "The Implication is that this model transforms liquidity from a temporary resource into structural capital, forming the backbone of the monetary network and supporting predictable settlement and exchange operations.",
        },
        {
          heading: "Exchange Mechanics",
          text: "Cryptonite Swap uses automated market maker (AMM) mechanics to determine exchange rates between NTC (Nite Treasury currency) and RefrenceDCs. Prices are determined systemically based on relative balances and mechanisms within the liquidity pools, enabling decentralized, low volatility and continuous reliable market pricing discovery without order books.\n\nExpanded Context:",
          list: [
            "Dynamic Price Discovery: Because liquidity is permanent, price movements reflect actual trading activity rather than transient liquidity shifts or speculative arbitrage.",
            "Protocol-Enforced Low Volatility: The system is designed to maintain low price volatility via permanent liquidity, ensuring that token prices remain stable relative to usage patterns.",
            "Market Incentives: Traders are encouraged to participate in markets with high liquidity to minimize costs, creating a self-reinforcing loop of stable and efficient exchange.",
            "Economic Transparency: AMM mechanics provide transparent, predictable pricing formulas, which is critical for systemic trust and settlement reliability.",
          ],
        },
        {
          heading: "Exchange Mechanics (continued)",
          text: "The Implication is that by combining AMM pricing with permanent liquidity, the system ensures accurate, usage-driven market signals and discourages speculative manipulation of exchange rates.",
        },
        {
          heading: "Separation of Exchange and Treasury",
          text: "Cryptonite Swap explicitly separates trading activity from treasury. Unlike systems where new tokens are minted or burned to balance trading flows, this design ensures that the money supply is independent of market transactions, preserving systemic integrity.\n\nExpanded Context:",
          list: [
            "Prevention of Reflexive Credit Expansion: Because trades do not generate new tokens, the system avoids unintended inflation or embedded leverage within the network.",
            "Mitigation of Systemic Contagion: Shocks in one pool cannot propagate through automatic minting or burning, protecting the network from cascading balance-sheet failures.",
            "Predictable Monetary Environment: Users and operators can rely on fixed total supply for settlement and liquidity planning.",
            "Infrastructural Clarity: The system's role is purely clearing and settlement, not credit creation or financial intermediation.",
          ],
        },
        {
          heading: "Separation of Exchange and Treasury (continued)",
          text: "The Implication of this separation is that it enforces monetary discipline, strengthens network resilience, and allows participants to trust that the platform clears capital without creating systemic risk.",
        },
        {
          heading: "Decentralization and Trust Model",
          text: "The Decentralization and Trust Model establishes that the core financial guarantees of Cryptonite Swap are enforced structurally by the protocol, rather than relying on governance decisions, centralized institutions or discretionary operators. While governance and development coordination may occur, all critical guarantees such as liquidity permanence, settlement integrity and protocol enforced low volatility are encoded into the architecture making trust in the system algorithmic and verifiable rather than institutional.\n\nExpanded Context and Key Principles:",
          list: [
            "Trust in Architecture, Not Institutions: Users interact with a system where guarantees are irreversible and transparent, shifting reliance from human actors to the immutable protocol rules. Liquidity permanence, AMM-based pricing and other structural mechanisms form the backbone of user trust, reducing exposure to governance failures or mismanagement.",
            "Immutable Financial Guarantees: Key system guarantees including permanent liquidity, protocol enforced low volatility, and separation of exchange from money creation are enforced automatically by the protocol. This ensures predictable outcomes regardless of operational errors, governance decisions or external interference.",
            "Resilience Against Manipulation: By encoding trust into the architecture the network is resistant to corruption, governance capture or operational manipulation. Market participants can transact confidently knowing that the protocol cannot retroactively alter pools, prices, or token supply.",
            "Decentralized Confidence and Participation: Protocol-enforced guarantees allow a diverse set of participants to engage in the network without relying on central intermediaries. Decentralization encourages network-wide participation, as stakeholders do not need to vet governance bodies or custodial agents for trust.",
            "Alignment of Incentives and Governance: Governance may coordinate upgrades, token introductions or parameter adjustments but cannot compromise structural guarantees. Incentives are aligned with protocol health: participants benefit from long-term stability, and no single actor can override core rules.",
            "Predictable, Trust-Minimized Ecosystem: By enforcing guarantees through code, smart contracts and permanent liquidity mechanisms, the system achieves a trust-minimized monetary network where participants can rely on transparent, consistent, and verifiable outcomes.",
          ],
        },
        {
          heading: "Decentralization and Trust Model — Implications",
          text: "Implications:",
          list: [
            "Users have confidence in network integrity without relying on institutions or intermediaries.",
            "Structural guarantees reduce systemic risk and prevent manipulation or governance capture.",
            "The system promotes broad adoption, since trust is based on verifiable protocol rules rather than reputation or central authority.",
            "Cryptonite Swap becomes a self-sustaining, resilient and predictable financial infrastructure, where participation and network effects drive growth without undermining stability.",
          ],
        },
        {
          heading: "Decentralization and Trust Model (continued)",
          text: "In essence, the Decentralization and Trust Model transforms trust from a subjective, institution-based concept into a protocol-enforced, verifiable property, ensuring that the network operates predictably and securely for all participants.",
        },
        {
          heading: "Expansion Model",
          text: "The Expansion Model is the framework by which new features and primarily Reference DCs are introduced into the Cryptonite Swap ecosystem, ensuring network growth while preserving the integrity, trust, and stability of existing liquidity commitments. Under this model, new tokens are added exclusively through the creation of new permanent liquidity pools against NTC and existing pools are never altered or withdrawn.\n\nExpanded Context and Key Principles:",
          list: [
            "Layered Infrastructure Growth: Each new Reference DCs and its associated liquidity pool adds a new layer of market infrastructure, allowing the network to scale without compromising the structural integrity of existing pools. This modular design ensures that the system can accommodate additional currencies over time while maintaining predictable behavior in existing markets.",
            "Preservation of Early Commitments: Liquidity providers in early pools retain full confidence that their contributions are immutable and perpetual. Trust established in prior commitments is not diluted by later expansions, which prevents disruptions to long-term participants.",
            "Organic Network Expansion: The model allows the network to grow incrementally and predictably, adding new tokens only through explicit pool creation. Each new pool introduces liquidity without creating dependencies or altering the supply, balance, or behavior of existing pools, maintaining systemic stability.",
            "Risk Management: By restricting modifications to existing pools, the Expansion Model prevents cross-pool contagion, where shocks in one new token could otherwise destabilize established pools. This structure also mitigates risks of speculative manipulation during token introduction, ensuring price signals remain market-driven.",
            "Structural Integrity and Governance Alignment: Expansion occurs through transparent, on-chain mechanisms, reinforcing the network's commitment to trust-minimized, protocol-driven operations. Governance coordination may facilitate pool creation, but cannot override the immutable status of prior pools, emphasizing decentralized security and consistency.",
          ],
        },
        {
          heading: "Expansion Model — Implications",
          text: "Implications:",
          list: [
            "Encourages long-term participation by early liquidity providers.",
            "Supports predictable and scalable growth of the ecosystem.",
            "Ensures systemic stability and transparency, even as new digital currencies are added.",
            "Reinforces confidence in the monetary infrastructure, allowing participants to engage without fear of retroactive changes or liquidity removal.",
          ],
        },
        {
          heading: "Expansion Model (continued)",
          text: "In essence, the Expansion Model transforms network growth into a layered, trust-preserving process, where each new digital currency enhances the ecosystem without compromising prior commitments or systemic stability.",
        },
      ],
    },
  ];
}

function Docs() {
  const [activeSection, setActiveSection] = useState("overview");
  const { getTokenPrice } = useTokenPrice();
  const { tokens: TOKENS } = useTokenList();
  const ntcToken = TOKENS.find((t) => t.isBase) || TOKENS[0];
  const pairTokens = TOKENS.filter((t) => !t.isBase);
  const sections = useMemo(() => buildSections(ntcToken), [ntcToken]);

  const currentSection = sections.find((s) => s.id === activeSection);

  return (
    <div className="page-container">
      <div className="docs-layout">
        <nav className="docs-nav">
          <div className="docs-nav-title">WhitePaper</div>
          {sections.map((section) => (
            <button
              key={section.id}
              className={`docs-nav-item ${activeSection === section.id ? "active" : ""}`}
              onClick={() => setActiveSection(section.id)}
            >
              <span className="docs-nav-icon">{section.icon}</span>
              <span>{section.title}</span>
            </button>
          ))}
        </nav>

        <div className="docs-content">
          <h1 className="docs-page-title">WhitePaper</h1>
          <h2 className="docs-section-title">
            <span className="docs-page-icon">{currentSection.icon}</span>
            {currentSection.title}
          </h2>

          {currentSection.content.map((block, i) => (
            <div key={i} className="docs-block">
              <h2 className="docs-heading">{block.heading}</h2>
              {block.text &&
                block.text.split("\n\n").map((para, pi) => (
                  <p key={pi} className="docs-text">{para}</p>
                ))}
              {block.list && (
                <ul className="docs-list">
                  {block.list.map((item, j) => (
                    <li key={j}>{item}</li>
                  ))}
                </ul>
              )}
              {block.tokenTable && (
                <div className="docs-token-table-wrapper">
                  <table className="docs-token-table">
                    <thead>
                      <tr>
                        <th>Symbol</th>
                        <th>Full Name</th>
                        <th>Fiat Reference</th>
                        <th>Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pairTokens.map((token) => (
                        <tr key={token.id}>
                          <td>
                            <div className="docs-token-badge-row">
                              <div
                                className="coin-icon-badge"
                                style={{
                                  background: `linear-gradient(135deg, ${token.color}, ${token.color}88)`,
                                  width: 28,
                                  height: 28,
                                  fontSize: 11,
                                }}
                              >
                                {token.symbol.slice(0, 2)}
                              </div>
                              <strong>{token.symbol}</strong>
                            </div>
                          </td>
                          <td>{token.fullName}</td>
                          <td>
                            {token.fiatName} ({token.fiatSymbol})
                          </td>
                          <td>${getTokenPrice(token.id).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default Docs;
