CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS trade_events (
  id              BIGSERIAL       PRIMARY KEY,
  event_type      VARCHAR(32)     NOT NULL,
  token_a_symbol  VARCHAR(16)     NOT NULL,
  token_b_symbol  VARCHAR(16)     NOT NULL,
  token_a_mint    VARCHAR(64)     NOT NULL DEFAULT '',
  token_b_mint    VARCHAR(64)     NOT NULL DEFAULT '',
  amount_in       DOUBLE PRECISION NOT NULL DEFAULT 0,
  amount_out      DOUBLE PRECISION NOT NULL DEFAULT 0,
  price           DOUBLE PRECISION NOT NULL DEFAULT 0,
  pool_address    VARCHAR(64)     NOT NULL DEFAULT '',
  tx_signature    VARCHAR(128)    NOT NULL DEFAULT '',
  wallet          VARCHAR(64)     NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trade_events_token_a ON trade_events (token_a_symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trade_events_token_b ON trade_events (token_b_symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trade_events_pair    ON trade_events (token_a_symbol, token_b_symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trade_events_type    ON trade_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trade_events_wallet_date ON trade_events (wallet, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trade_events_token_b_lower ON trade_events (lower(token_b_symbol), event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS chart_candles (
  id              BIGSERIAL       PRIMARY KEY,
  token_symbol    VARCHAR(16)     NOT NULL,
  interval_key    VARCHAR(8)      NOT NULL,
  bucket          TIMESTAMPTZ     NOT NULL,
  open            DOUBLE PRECISION NOT NULL DEFAULT 0,
  high            DOUBLE PRECISION NOT NULL DEFAULT 0,
  low             DOUBLE PRECISION NOT NULL DEFAULT 0,
  close           DOUBLE PRECISION NOT NULL DEFAULT 0,
  volume          DOUBLE PRECISION NOT NULL DEFAULT 0,
  trade_count     INT              NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  UNIQUE(token_symbol, interval_key, bucket)
);

CREATE INDEX IF NOT EXISTS idx_chart_candles_lookup ON chart_candles (token_symbol, interval_key, bucket DESC);

CREATE TABLE IF NOT EXISTS token_stats_cache (
  token_symbol    VARCHAR(16)     PRIMARY KEY,
  latest_price    DOUBLE PRECISION NOT NULL DEFAULT 0,
  price_24h_ago   DOUBLE PRECISION NOT NULL DEFAULT 0,
  price_7d_ago    DOUBLE PRECISION NOT NULL DEFAULT 0,
  earliest_price  DOUBLE PRECISION NOT NULL DEFAULT 0,
  volume_24h      DOUBLE PRECISION NOT NULL DEFAULT 0,
  trades_24h      INT              NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_overview_seed (
  period          VARCHAR(16)     PRIMARY KEY,
  referral_data   JSONB           NOT NULL DEFAULT '[]',
  traffic_data    JSONB           NOT NULL DEFAULT '[]',
  weekly_data     JSONB           NOT NULL DEFAULT '[]',
  most_viewed     JSONB           NOT NULL DEFAULT '[]',
  platform_stats  JSONB           NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS user_wallets (
  wallet          VARCHAR(64)     PRIMARY KEY,
  first_seen      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  last_seen       TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS page_visits (
  id              BIGSERIAL       PRIMARY KEY,
  session_id      VARCHAR(64)     NOT NULL DEFAULT '',
  wallet          VARCHAR(64)     NOT NULL DEFAULT '',
  page            VARCHAR(128)    NOT NULL,
  source          VARCHAR(32)     NOT NULL DEFAULT 'direct',
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_page_visits_created ON page_visits (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_page_visits_source  ON page_visits (source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_wallets_first  ON user_wallets (first_seen DESC);

CREATE TABLE IF NOT EXISTS fee_events (
  id              BIGSERIAL        PRIMARY KEY,
  token_mint      VARCHAR(64)      NOT NULL,
  token_symbol    VARCHAR(16)      NOT NULL DEFAULT '',
  amount          DOUBLE PRECISION NOT NULL DEFAULT 0,
  fee_type        VARCHAR(32)      NOT NULL,
  tx_signature    VARCHAR(128)     NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fee_events_token ON fee_events (token_mint, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fee_events_type  ON fee_events (fee_type, created_at DESC);

CREATE TABLE IF NOT EXISTS program_config (
  key             VARCHAR(64)     PRIMARY KEY,
  value           VARCHAR(128)    NOT NULL,
  updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tokens (
  id              SERIAL          PRIMARY KEY,
  symbol          VARCHAR(16)     NOT NULL UNIQUE,
  name            VARCHAR(128)    NOT NULL,
  mint_address    VARCHAR(64)     NOT NULL UNIQUE,
  decimals        INT             NOT NULL DEFAULT 5,
  supply          VARCHAR(64)     NOT NULL DEFAULT '0',
  metadata_uri    VARCHAR(256)    NOT NULL DEFAULT '',
  image_url       VARCHAR(256)    NOT NULL DEFAULT '',
  tx_signature    VARCHAR(128)    NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tokens_symbol ON tokens (symbol);

CREATE TABLE IF NOT EXISTS multisig_config (
  id                      SERIAL      PRIMARY KEY,
  multisig_pda            VARCHAR(64) NOT NULL,
  treasury_authority_pda  VARCHAR(64) NOT NULL,
  program_id              VARCHAR(64) NOT NULL,
  owners                  JSONB       NOT NULL DEFAULT '[]',
  threshold               INT         NOT NULL DEFAULT 2,
  allowed_programs        JSONB       NOT NULL DEFAULT '[]',
  tx_signature            VARCHAR(128) NOT NULL DEFAULT '',
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS multisig_owners (
  id          SERIAL      PRIMARY KEY,
  owner1      VARCHAR(64) NOT NULL,
  owner2      VARCHAR(64) NOT NULL,
  owner3      VARCHAR(64) NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS treasury_wallets (
  id              SERIAL          PRIMARY KEY,
  token_symbol    VARCHAR(16)     NOT NULL,
  mint_address    VARCHAR(64)     NOT NULL,
  treasury_ata    VARCHAR(64)     NOT NULL,
  tx_signature    VARCHAR(128)    NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_treasury_wallets_mint ON treasury_wallets (mint_address);

CREATE TABLE IF NOT EXISTS pools (
  id              SERIAL          PRIMARY KEY,
  token_a_symbol  VARCHAR(16)     NOT NULL,
  token_b_symbol  VARCHAR(16)     NOT NULL,
  token_a_mint    VARCHAR(64)     NOT NULL DEFAULT '',
  token_b_mint    VARCHAR(64)     NOT NULL DEFAULT '',
  pool_address    VARCHAR(64)     NOT NULL UNIQUE,
  tick_spacing    INT             NOT NULL DEFAULT 64,
  fee_tier        DOUBLE PRECISION NOT NULL DEFAULT 0.30,
  tx_signature    VARCHAR(128)    NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pools_pair ON pools (token_a_symbol, token_b_symbol);

CREATE TABLE IF NOT EXISTS swap_limit_config (
  id              SERIAL            PRIMARY KEY,
  daily_limit     DOUBLE PRECISION  NOT NULL DEFAULT 100,
  monthly_limit   DOUBLE PRECISION  NOT NULL DEFAULT 500,
  updated_by      VARCHAR(64)       NOT NULL DEFAULT '',
  updated_at      TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS swap_limit_proposals (
  id                 SERIAL            PRIMARY KEY,
  transaction_index  INT               NOT NULL UNIQUE,
  proposed_daily     DOUBLE PRECISION  NOT NULL,
  proposed_monthly   DOUBLE PRECISION  NOT NULL,
  current_daily      DOUBLE PRECISION  NOT NULL DEFAULT 100,
  current_monthly    DOUBLE PRECISION  NOT NULL DEFAULT 500,
  creator            VARCHAR(64)       NOT NULL,
  status             VARCHAR(20)       NOT NULL DEFAULT 'active',
  approvals          INT               NOT NULL DEFAULT 0,
  threshold          INT               NOT NULL DEFAULT 2,
  approved_by        JSONB             NOT NULL DEFAULT '[]',
  propose_signature  VARCHAR(128)      NOT NULL DEFAULT '',
  approve_signatures JSONB             NOT NULL DEFAULT '[]',
  execute_signature  VARCHAR(128)      NOT NULL DEFAULT '',
  created_at         TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS token_prices (
  id              BIGSERIAL         PRIMARY KEY,
  token_symbol    VARCHAR(16)       NOT NULL,
  token_mint      VARCHAR(64)       NOT NULL,
  pair_symbol     VARCHAR(16)       NOT NULL DEFAULT '',
  pair_mint       VARCHAR(64)       NOT NULL DEFAULT '',
  pool_address    VARCHAR(64)       NOT NULL DEFAULT '',
  price           DOUBLE PRECISION  NOT NULL,
  liquidity       VARCHAR(64)       NOT NULL DEFAULT '0',
  source          VARCHAR(32)       NOT NULL DEFAULT 'pool',
  volume          DOUBLE PRECISION  NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_token_prices_symbol ON token_prices (token_symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_token_prices_mint   ON token_prices (token_mint, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_token_prices_pair   ON token_prices (token_symbol, pair_symbol, created_at DESC);

CREATE TABLE IF NOT EXISTS referral_codes (
  id          SERIAL        PRIMARY KEY,
  code        VARCHAR(16)   NOT NULL UNIQUE,
  wallet      VARCHAR(64)   NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referral_uses (
  id                    SERIAL          PRIMARY KEY,
  code                  VARCHAR(16)     NOT NULL,
  referrer_wallet       VARCHAR(64)     NOT NULL,
  referee_wallet        VARCHAR(64)     NOT NULL UNIQUE,
  referee_first_swap    BOOLEAN         NOT NULL DEFAULT FALSE,
  referrer_rewarded     BOOLEAN         NOT NULL DEFAULT FALSE,
  referee_rewarded      BOOLEAN         NOT NULL DEFAULT FALSE,
  referrer_reward_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  referee_reward_amount  DOUBLE PRECISION NOT NULL DEFAULT 0,
  referrer_reward_tx    VARCHAR(128),
  referee_reward_tx     VARCHAR(128),
  created_at            TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referral_config (
  id              SERIAL          PRIMARY KEY,
  referrer_reward DOUBLE PRECISION NOT NULL DEFAULT 0.25,
  referee_reward  DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  updated_by      VARCHAR(64)     NOT NULL DEFAULT '',
  updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referral_reward_proposals (
  id                      SERIAL          PRIMARY KEY,
  transaction_index       INT             NOT NULL UNIQUE,
  proposed_referrer_reward DOUBLE PRECISION NOT NULL,
  proposed_referee_reward  DOUBLE PRECISION NOT NULL,
  current_referrer_reward  DOUBLE PRECISION NOT NULL DEFAULT 0.25,
  current_referee_reward   DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  creator                 VARCHAR(64)     NOT NULL,
  status                  VARCHAR(20)     NOT NULL DEFAULT 'active',
  approvals               INT             NOT NULL DEFAULT 0,
  threshold               INT             NOT NULL DEFAULT 2,
  approved_by             JSONB           NOT NULL DEFAULT '[]',
  execute_signature       VARCHAR(128)    NOT NULL DEFAULT '',
  created_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS token_buy_price_config (
  id              SERIAL            PRIMARY KEY,
  token_symbol    VARCHAR(16)       NOT NULL UNIQUE,
  price_usd       DOUBLE PRECISION  NOT NULL,
  updated_by      VARCHAR(64)       NOT NULL DEFAULT '',
  updated_at      TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS token_buy_price_proposals (
  id                 SERIAL            PRIMARY KEY,
  transaction_index  INT               NOT NULL UNIQUE,
  token_symbol       VARCHAR(16)       NOT NULL,
  proposed_price     DOUBLE PRECISION  NOT NULL,
  current_price      DOUBLE PRECISION  NOT NULL DEFAULT 0,
  creator            VARCHAR(64)       NOT NULL,
  status             VARCHAR(20)       NOT NULL DEFAULT 'active',
  approvals          INT               NOT NULL DEFAULT 0,
  threshold          INT               NOT NULL DEFAULT 2,
  approved_by        JSONB             NOT NULL DEFAULT '[]',
  propose_signature  VARCHAR(128)      NOT NULL DEFAULT '',
  approve_signatures JSONB             NOT NULL DEFAULT '[]',
  execute_signature  VARCHAR(128)      NOT NULL DEFAULT '',
  created_at         TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS moonpay_transactions (
  id                      UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  user_wallet             VARCHAR(64)     NOT NULL,
  update_token            VARCHAR(64)     NOT NULL DEFAULT '',
  type                    VARCHAR(10)     NOT NULL DEFAULT 'buy',
  moonpay_transaction_id  VARCHAR(128)    NOT NULL DEFAULT '',
  status                  VARCHAR(20)     NOT NULL DEFAULT 'pending',
  crypto_currency         VARCHAR(16)     NOT NULL DEFAULT '',
  fiat_currency           VARCHAR(16)     NOT NULL DEFAULT 'USD',
  amount_fiat             DOUBLE PRECISION NOT NULL DEFAULT 0,
  amount_crypto           DOUBLE PRECISION NOT NULL DEFAULT 0,
  token_price             DOUBLE PRECISION NOT NULL DEFAULT 0,
  tx_signature            VARCHAR(128)    NOT NULL DEFAULT '',
  moonpay_status          VARCHAR(32)     NOT NULL DEFAULT '',
  widget_url              TEXT            NOT NULL DEFAULT '',
  created_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_moonpay_tx_wallet ON moonpay_transactions (user_wallet, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_moonpay_tx_mpid   ON moonpay_transactions (moonpay_transaction_id);

CREATE TABLE IF NOT EXISTS admin_wallets (
  id          SERIAL          PRIMARY KEY,
  wallet      VARCHAR(64)     NOT NULL UNIQUE,
  role        VARCHAR(32)     NOT NULL DEFAULT 'admin',
  added_by    VARCHAR(64)     NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_wallets_wallet ON admin_wallets (wallet);

CREATE TABLE IF NOT EXISTS token_purchases (
  id                      UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  user_wallet             VARCHAR(64)     NOT NULL,
  ntc_amount              DOUBLE PRECISION NOT NULL DEFAULT 0,
  price_usd               DOUBLE PRECISION NOT NULL DEFAULT 0,
  pay_currency            VARCHAR(16)     NOT NULL DEFAULT '',
  pay_amount              DOUBLE PRECISION NOT NULL DEFAULT 0,
  nowpayments_id          BIGINT          DEFAULT NULL,
  nowpayments_status      VARCHAR(32)     NOT NULL DEFAULT '',
  pay_address             VARCHAR(256)    NOT NULL DEFAULT '',
  status                  VARCHAR(20)     NOT NULL DEFAULT 'pending',
  ntc_tx_signature        VARCHAR(128)    NOT NULL DEFAULT '',
  pay_tx_hash             VARCHAR(128)    NOT NULL DEFAULT '',
  confirmed_at            TIMESTAMPTZ     DEFAULT NULL,
  sent_at                 TIMESTAMPTZ     DEFAULT NULL,
  token_symbol            VARCHAR(16)     NOT NULL DEFAULT 'NTC',
  created_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_token_purchases_wallet ON token_purchases (user_wallet, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_token_purchases_np_id  ON token_purchases (nowpayments_id);
