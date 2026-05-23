import test from "node:test";
import assert from "node:assert/strict";
import {
  createDirectSymbolCandidates,
  createReturnSymbolCandidates,
  getReturnDataWithFallback,
  searchCatalog
} from "../server.js";
import {
  loadMarketSymbolCache,
  refreshMarketSymbolCache,
  searchMarketSymbols
} from "../src/market-symbol-cache.js";

test("direct symbol candidates support Taiwan leveraged ETF codes", () => {
  const results = createDirectSymbolCandidates("00675L");

  assert.deepEqual(results.map((result) => result.symbol), ["00675L.TW", "00675L.TWO"]);
  assert.deepEqual(results.map((result) => result.name), ["00675L 台灣上市股票或 ETF", "00675L 台灣上櫃股票或 ETF"]);
});

test("direct symbol candidates support explicit exchange suffixes", () => {
  const results = createDirectSymbolCandidates("LTT.SG");

  assert.equal(results[0].symbol, "LTT.SG");
  assert.equal(results[0].code, "LTT");
});

test("direct symbol candidates normalize class share tickers", () => {
  assert.equal(createDirectSymbolCandidates("BRK.B")[0].symbol, "BRK-B");
  assert.equal(createDirectSymbolCandidates("BRK/B")[0].symbol, "BRK-B");
});

test("catalog code searches do not fuzzy-match similar ticker codes", () => {
  assert.deepEqual(searchCatalog("00675L"), []);
});

test("catalog Taiwan results use Traditional Chinese display names", () => {
  assert.equal(searchCatalog("2330")[0].name, "台積電");
  assert.equal(searchCatalog("元大0050正二")[0].name, "元大台灣50正二");
  assert.equal(searchCatalog("興勤")[0].symbol, "2428.TW");
  assert.equal(searchCatalog("大銀微系統")[0].symbol, "4576.TW");
  assert.equal(searchCatalog("sitime")[0].symbol, "SITM");
});

test("returns candidate list falls back from Taiwan OTC to listed exchange", () => {
  assert.deepEqual(createReturnSymbolCandidates("00675L.TWO"), ["00675L.TWO", "00675L.TW"]);
});

test("returns candidate list normalizes class share tickers", () => {
  assert.deepEqual(createReturnSymbolCandidates("BRK/B"), ["BRK-B"]);
  assert.deepEqual(createReturnSymbolCandidates("BRK.B"), ["BRK-B"]);
});

test("return data falls back to the first Taiwan symbol with chart data", async () => {
  const originalFetch = globalThis.fetch;
  const requestedSymbols = [];

  globalThis.fetch = async (url) => {
    const symbol = decodeURIComponent(new URL(url).pathname.split("/").pop());
    requestedSymbols.push(symbol);

    if (symbol === "00675L.TWO") {
      return new Response("{}", { status: 404 });
    }

    if (symbol === "00675L.TW") {
      return new Response(JSON.stringify({
        chart: {
          result: [
            {
              timestamp: [1_735_689_600, 1_738_281_600],
              indicators: {
                adjclose: [
                  { adjclose: [100, 150] }
                ]
              },
              meta: { currency: "TWD" }
            }
          ]
        }
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response("{}", { status: 404 });
  };

  try {
    const result = await getReturnDataWithFallback("00675L.TWO", 12);

    assert.deepEqual(requestedSymbols, ["00675L.TWO", "00675L.TW"]);
    assert.equal(result.symbol, "00675L.TW");
    assert.equal(result.returnRate, 50);
    assert.equal(result.currency, "TWD");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("market symbol cache writes disk cache and searches symbols", async () => {
  const originalFetch = globalThis.fetch;
  const cachePath = `/tmp/interest-rate-market-symbols-${Date.now()}.json`;

  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value.includes("STOCK_DAY_ALL")) {
      return new Response(JSON.stringify([
        { Code: "2428", Name: "興勤" },
        { Code: "4576", Name: "大銀微系統" }
      ]), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (value.includes("tpex_mainboard_quotes")) {
      return new Response(JSON.stringify([
        { SecuritiesCompanyCode: "8069", CompanyName: "元太" }
      ]), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (value.includes("api.nasdaq.com")) {
      return new Response(JSON.stringify({
        data: {
          rows: [
            { symbol: "SITM", name: "SiTime Corporation", exchange: "NASDAQ" },
            { symbol: "BRK/B", name: "Berkshire Hathaway Inc.", exchange: "NYSE" }
          ]
        }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("{}", { status: 404 });
  };

  try {
    const cache = await refreshMarketSymbolCache(cachePath);
    assert.equal(cache.sources.twse, 2);
    assert.equal(cache.sources.tpex, 1);
    assert.equal(cache.sources.us, 2);

    const loaded = await loadMarketSymbolCache({ cachePath, ttlMs: 24 * 60 * 60 * 1000 });
    assert.equal(loaded.items.length, 5);
    assert.equal((await searchMarketSymbols("興勤", { cachePath }))[0].symbol, "2428.TW");
    assert.equal((await searchMarketSymbols("sitime", { cachePath }))[0].symbol, "SITM");
    assert.equal((await searchMarketSymbols("brk-b", { cachePath }))[0].symbol, "BRK-B");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("market symbol cache applies English aliases for Taiwan companies", async () => {
  const originalFetch = globalThis.fetch;
  const cachePath = `/tmp/interest-rate-market-symbols-alias-${Date.now()}.json`;

  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value.includes("STOCK_DAY_ALL")) {
      return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (value.includes("tpex_mainboard_quotes")) {
      return new Response(JSON.stringify([
        { SecuritiesCompanyCode: "5274", CompanyName: "信驊" }
      ]), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (value.includes("api.nasdaq.com")) {
      return new Response(JSON.stringify({ data: { rows: [] } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("{}", { status: 404 });
  };

  try {
    await refreshMarketSymbolCache(cachePath);
    const result = await searchMarketSymbols("aspeed", { cachePath });
    assert.equal(result[0].symbol, "5274.TWO");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
