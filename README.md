# Interest Rate Comparison Tool

A zero-dependency web tool for comparing loan costs with stock returns over a selected period.

## Features

- Loan monthly payment calculator with annual rate, term, and grace period controls.
- Stock search by company name, ticker, or numeric code.
- Stock return calculation from adjusted close prices.
- Dark responsive interface.
- Built-in Node.js server for static files and market data proxy endpoints.

## Requirements

- Node.js 20 or later.

## Development

```bash
npm run dev
```

Then open the local URL printed by the server.

## LAN Access

To allow other computers on the same network to use the service, start it on all network interfaces:

```bash
./start-lan.sh
```

The script prints both the local URL and LAN URLs such as:

```text
http://192.168.1.20:5173
```

Open that LAN URL from another computer on the same Wi-Fi or wired network. If the page does not load, allow inbound TCP traffic to port `5173` in the host firewall.

You can also choose a different port:

```bash
PORT=8080 ./start-lan.sh
```

Stop the server with:

```bash
./stop.sh
```

## Tests

```bash
npm test
```

## Market Data

The server queries Yahoo Finance-compatible public endpoints at runtime. Availability depends on network access and upstream response behavior.
