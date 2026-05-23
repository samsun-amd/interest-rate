# Interest Rate Comparison Tool

A zero-dependency Node.js web tool for comparing loan payments, stock returns, stock-funded repayment, pure holding, and dollar-cost averaging.

## Requirements

- Ubuntu or another Linux system with `systemd --user`
- Node.js 20 or later
- Internet access for market data and cache refresh

Check Node.js:

```bash
node --version
```

## Quick Deploy

Run these commands from a terminal:

```bash
cd /home/chisun/slai.codex/github/interest-rate
./install-service.sh
```

Open:

```text
http://127.0.0.1:5173/
```

Check service status:

```bash
cd /home/chisun/slai.codex/github/interest-rate
./status.sh
```

## Daily Commands

Start or restart the service:

```bash
systemctl --user restart interest-rate.service
```

Stop the service:

```bash
systemctl --user stop interest-rate.service
```

Start the service:

```bash
systemctl --user start interest-rate.service
```

Check the service:

```bash
systemctl --user status interest-rate.service
```

Show logs:

```bash
journalctl --user -u interest-rate.service -f
```

Disable and remove the service:

```bash
cd /home/chisun/slai.codex/github/interest-rate
./uninstall-service.sh
```

## Script-Based Run

If systemd is not needed, use the project scripts:

```bash
cd /home/chisun/slai.codex/github/interest-rate
./start.sh
```

Check status:

```bash
./status.sh
```

Stop:

```bash
./stop.sh
```

Restart:

```bash
./stop.sh
./start.sh
```

## LAN Access

To allow other devices on the same network to open the web page:

```bash
cd /home/chisun/slai.codex/github/interest-rate
./stop.sh
HOST=0.0.0.0 PORT=5173 ./start.sh
```

The script prints LAN URLs. Open one from another device, for example:

```text
http://192.168.1.20:5173/
```

If the page does not load, allow inbound TCP traffic to port `5173` in the host firewall.

## Market Symbol Cache

Search uses a lightweight disk cache:

```text
.cache/market-symbols.json
```

The cache stores symbols, names, exchanges, and aliases only. It does not store price history.

Default TTL:

```text
24 hours
```

The service refreshes stale cache automatically during search. If refresh fails, it keeps using the old cache.

## Update Market Cache

From the web page:

```text
Click "更新資料"
```

From CLI:

```bash
cd /home/chisun/slai.codex/github/interest-rate
npm run cache:refresh
```

Check cache status:

```bash
cd /home/chisun/slai.codex/github/interest-rate
npm run cache:status
```

Search cache from CLI:

```bash
cd /home/chisun/slai.codex/github/interest-rate
node scripts/refresh-market-cache.js search aspeed
node scripts/refresh-market-cache.js search 興勤
node scripts/refresh-market-cache.js search 元太
```

Update cache through the local API:

```bash
curl -X POST "http://127.0.0.1:5173/api/market-cache?action=refresh"
```

Check cache through the local API:

```bash
curl "http://127.0.0.1:5173/api/market-cache"
```

The refresh API only allows local requests from `127.0.0.1` or `::1`.

## Development

Run in the foreground:

```bash
cd /home/chisun/slai.codex/github/interest-rate
npm run dev
```

Run tests:

```bash
cd /home/chisun/slai.codex/github/interest-rate
npm test
```

Syntax check:

```bash
cd /home/chisun/slai.codex/github/interest-rate
node --check server.js
node --check src/main.js
node --check src/market-symbol-cache.js
```

## Configuration

Default endpoint:

```text
HOST=127.0.0.1
PORT=5173
```

Start with custom endpoint using scripts:

```bash
HOST=0.0.0.0 PORT=8080 ./start.sh
```

Market cache TTL:

```bash
MARKET_SYMBOL_CACHE_TTL_MS=86400000
```

Custom cache path:

```bash
MARKET_SYMBOL_CACHE=/tmp/market-symbols.json npm run cache:refresh
```

## Files

Main server:

```text
server.js
```

Frontend:

```text
src/main.js
src/styles.css
```

Market cache:

```text
src/market-symbol-cache.js
.cache/market-symbols.json
scripts/refresh-market-cache.js
```

Service files:

```text
interest-rate.service
install-service.sh
uninstall-service.sh
status.sh
```
