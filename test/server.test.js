import test from "node:test";
import assert from "node:assert/strict";
import {
  createDirectSymbolCandidates,
  createReturnSymbolCandidates,
  getReturnDataWithFallback,
  searchCatalog
} from "../server.js";

test("direct symbol candidates support Taiwan leveraged ETF codes", () => {
  const results = createDirectSymbolCandidates("00675L");

  assert.deepEqual(results.map((result) => result.symbol), ["00675L.TW", "00675L.TWO"]);
  assert.deepEqual(results.map((result) => result.name), ["00675L 台灣上市股票或 ETF", "00675L 台灣上櫃股票或 ETF"]);
});

test("catalog code searches do not fuzzy-match similar ticker codes", () => {
  assert.deepEqual(searchCatalog("00675L"), []);
});

test("catalog Taiwan results use Traditional Chinese display names", () => {
  assert.equal(searchCatalog("2330")[0].name, "台積電");
  assert.equal(searchCatalog("元大0050正二")[0].name, "元大台灣50正二");
});

test("returns candidate list falls back from Taiwan OTC to listed exchange", () => {
  assert.deepEqual(createReturnSymbolCandidates("00675L.TWO"), ["00675L.TWO", "00675L.TW"]);
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
