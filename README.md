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

## Tests

```bash
npm test
```

## Market Data

The server queries Yahoo Finance-compatible public endpoints at runtime. Availability depends on network access and upstream response behavior.
