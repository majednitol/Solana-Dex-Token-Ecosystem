# Cryptonite Swap — DigitalOcean VM Deployment Guide

Deploy the Cryptonite Swap application on an Ubuntu VM with Nginx, Node.js, and Redis.

## Prerequisites

- Ubuntu 22.04+ (or Debian 12+) VM with at least 2 GB RAM
- A domain name pointed to your VM's IP (for SSL)
- SSH access with sudo privileges

## 1. System Setup

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential
```

### Install Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v  # should show v20.x
```

### Install Redis

```bash
sudo apt install -y redis-server
sudo systemctl enable redis-server
sudo systemctl start redis-server
redis-cli ping  # should return PONG
```

### Install Nginx

```bash
sudo apt install -y nginx
sudo systemctl enable nginx
```

### Install PM2

```bash
sudo npm install -g pm2
```

## 2. Clone and Install

```bash
cd /var/www
sudo git clone <your-repo-url> cryptonite
sudo chown -R $USER:$USER cryptonite
cd cryptonite
npm install
```

## 3. Build Frontend

```bash
cd frontend
npm install
npm run build
cd ..
```

Verify `frontend/dist/index.html` exists after build.

## 4. Configure Environment Variables

```bash
cp api/.env.example api/.env
nano api/.env
```

Fill in your actual values:

| Variable | Description |
|----------|-------------|
| `SOLANA_RPC_URL` | Solana RPC endpoint (devnet or mainnet) |
| `WALLET_KEY` | Base58-encoded private key for the server wallet |
| `TOKEN_REGISTRY_SEED` | Token registry PDA seed (default: `token_registry`) |
| `NEON_DATABASE_URL` | PostgreSQL connection string (Neon DB) |
| `REDIS_URL` | Redis URL (default: `redis://127.0.0.1:6379`) |
| `API_PORT` | API server port (default: `8080`) |
| `NOWPAYMENTS_API_KEY` | NOWPayments API key |
| `NOWPAYMENTS_IPN_SECRET` | NOWPayments IPN webhook secret |
| `VITE_WALLETCONNECT_PROJECT_ID` | WalletConnect project ID |

## 5. Configure Nginx

```bash
sudo cp deploy/nginx-cryptonite.conf /etc/nginx/sites-available/cryptonite
sudo ln -sf /etc/nginx/sites-available/cryptonite /etc/nginx/sites-enabled/cryptonite
sudo rm -f /etc/nginx/sites-enabled/default
```

Edit the config to set your domain:

```bash
sudo nano /etc/nginx/sites-available/cryptonite
```

Change `server_name _;` to `server_name yourdomain.com;`

Update the `root` path if your project is in a different location:

```
root /var/www/cryptonite/frontend/dist;
```

Test and reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 6. Start with PM2

```bash
cd /var/www/cryptonite
pm2 start scripts/start-production.sh --name cryptonite
pm2 save
pm2 startup  # follow the printed command to enable auto-start on boot
```

Verify it's running:

```bash
pm2 status
pm2 logs cryptonite
curl http://localhost:8080/health  # should return JSON
curl http://localhost/api/health   # should return JSON through Nginx
```

## 7. SSL with Certbot

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

Certbot will automatically update your Nginx config for HTTPS. Auto-renewal is enabled by default.

Verify:

```bash
sudo certbot renew --dry-run
```

## Updating the App

```bash
cd /var/www/cryptonite
git pull
npm install
cd frontend && npm install && npm run build && cd ..
pm2 restart cryptonite
```

## Troubleshooting

### APIs return HTML instead of JSON

Nginx is not proxying `/api/` requests. Check:

```bash
sudo nginx -t
sudo cat /etc/nginx/sites-enabled/cryptonite
curl -v http://localhost:8080/health    # direct to API
curl -v http://localhost/api/health     # through Nginx
```

### SSE streaming not working

Ensure `/api/chart/stream` location block has `proxy_buffering off`. Check the Nginx config includes the SSE-specific location block.

### Redis connection errors

```bash
redis-cli ping
sudo systemctl status redis-server
```

If Redis is not running, the app will still work but without caching (slower responses).

### PM2 process keeps restarting

Check logs for missing environment variables:

```bash
pm2 logs cryptonite --lines 50
```

Common cause: missing `NEON_DATABASE_URL`, `WALLET_KEY`, or `SOLANA_RPC_URL` in `api/.env`.

### Check which port API is listening on

```bash
ss -tlnp | grep 8080
```

The API should be listening on `0.0.0.0:8080`.
