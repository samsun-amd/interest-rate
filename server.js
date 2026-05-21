import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { calculateReturnRate } from "./src/calculations.js";
import { localizedStockCatalog } from "./src/i18n/stock-catalog.zh-TW.js";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 5173);
const publicDir = join(rootDir, "public");
const allowedStaticRoots = [publicDir, join(rootDir, "src")];

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"]
]);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (url.pathname === "/api/search") {
      await handleSearch(url, response);
      return;
    }

    if (url.pathname === "/api/returns") {
      await handleReturns(url, response);
      return;
    }

    await serveStatic(url.pathname, response);
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: "internal_error" });
  }
});

server.listen(port, host, () => {
  console.log(`Server running at http://${host}:${port}`);
});

async function handleSearch(url, response) {
  const query = (url.searchParams.get("q") || "").trim();
  if (!query) {
    sendJson(response, 400, { error: "missing_query" });
    return;
  }

  try {
    const yahooResults = await settleSearch(searchYahoo(query));
    const catalogResults = searchCatalog(query);
    const directResults = createDirectSymbolCandidates(query);
    const results = dedupeResults([...catalogResults, ...directResults, ...yahooResults]).slice(0, 12);
    sendJson(response, 200, { results });
  } catch (error) {
    console.error(error);
    sendJson(response, 502, { error: "upstream_search_failed" });
  }
}

async function handleReturns(url, response) {
  const symbol = (url.searchParams.get("symbol") || "").trim();
  const months = Number(url.searchParams.get("months") || 0);

  if (!symbol) {
    sendJson(response, 400, { error: "missing_symbol" });
    return;
  }
  if (!Number.isFinite(months) || months < 1 || months > 240) {
    sendJson(response, 400, { error: "invalid_months" });
    return;
  }

  try {
    const payload = await getReturnData(symbol, months);
    sendJson(response, 200, payload);
  } catch (error) {
    if (error.message === "insufficient_data") {
      sendJson(response, 422, { error: "insufficient_data" });
      return;
    }
    console.error(error);
    sendJson(response, 502, { error: "upstream_returns_failed" });
  }
}

async function serveStatic(pathname, response) {
  const cleanPath = pathname === "/" ? "/index.html" : pathname;
  const decodedPath = decodeURIComponent(cleanPath);
  const relativePath = decodedPath.replace(/^\/+/, "");
  const candidateRoots = decodedPath.startsWith("/src/") ? [rootDir] : [publicDir];

  for (const baseDir of candidateRoots) {
    const absolutePath = normalize(join(baseDir, relativePath));
    const isAllowed = allowedStaticRoots.some((allowedRoot) => absolutePath.startsWith(allowedRoot));
    if (!isAllowed) {
      continue;
    }

    try {
      const body = await readFile(absolutePath);
      response.writeHead(200, {
        "Content-Type": mimeTypes.get(extname(absolutePath)) || "application/octet-stream",
        "Cache-Control": "no-store"
      });
      response.end(body);
      return;
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  sendJson(response, 404, { error: "not_found" });
}

async function searchYahoo(query) {
  const url = new URL("https://query2.finance.yahoo.com/v1/finance/search");
  url.searchParams.set("q", query);
  url.searchParams.set("quotesCount", "10");
  url.searchParams.set("newsCount", "0");
  url.searchParams.set("enableFuzzyQuery", "true");

  const payload = await fetchJson(url);
  const quotes = Array.isArray(payload.quotes) ? payload.quotes : [];
  return quotes
    .filter((quote) => quote.symbol && !quote.isYahooFinance)
    .map(toSearchResult);
}

async function settleSearch(promise) {
  try {
    return await promise;
  } catch {
    return [];
  }
}

function searchCatalog(query) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return [];
  }

  return localizedStockCatalog
    .map((stock) => ({
      stock,
      score: scoreStock(stock, normalizedQuery)
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.stock.symbol.localeCompare(b.stock.symbol))
    .map((entry) => ({
      name: entry.stock.name,
      symbol: entry.stock.symbol,
      code: entry.stock.code,
      exchange: entry.stock.exchange,
      type: "EQUITY"
    }));
}

function createDirectSymbolCandidates(query) {
  const normalized = String(query || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!normalized) {
    return [];
  }

  const results = [];

  if (/^\d{3,6}[A-Z]{0,2}$/.test(normalized)) {
    results.push(
      {
        name: `${normalized} Taiwan listed equity or ETF`,
        symbol: `${normalized}.TW`,
        code: normalized,
        exchange: "Taiwan Stock Exchange",
        type: "EQUITY"
      },
      {
        name: `${normalized} Taiwan OTC equity or ETF`,
        symbol: `${normalized}.TWO`,
        code: normalized,
        exchange: "Taipei Exchange",
        type: "EQUITY"
      }
    );
  }

  if (/^[A-Z]{1,5}$/.test(normalized)) {
    results.push({
      name: `${normalized} US listed equity or ETF`,
      symbol: normalized,
      code: normalized,
      exchange: "US Market",
      type: "EQUITY"
    });
  }

  return results;
}

async function getReturnData(symbol, months) {
  const now = new Date();
  const start = new Date(now);
  start.setMonth(start.getMonth() - months);

  const period1 = Math.floor(start.getTime() / 1000);
  const period2 = Math.floor(now.getTime() / 1000);
  const interval = months > 60 ? "1wk" : "1d";

  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set("period1", String(period1));
  url.searchParams.set("period2", String(period2));
  url.searchParams.set("interval", interval);
  url.searchParams.set("events", "history");
  url.searchParams.set("includeAdjustedClose", "true");

  const payload = await fetchJson(url);
  const result = payload.chart?.result?.[0];
  if (!result || !Array.isArray(result.timestamp)) {
    throw new Error("insufficient_data");
  }

  const timestamps = result.timestamp;
  const closes = result.indicators?.adjclose?.[0]?.adjclose || result.indicators?.quote?.[0]?.close || [];
  const series = timestamps
    .map((timestamp, index) => ({
      date: formatDate(new Date(timestamp * 1000)),
      price: Number(closes[index])
    }))
    .filter((point) => Number.isFinite(point.price) && point.price > 0);

  if (series.length < 2) {
    throw new Error("insufficient_data");
  }

  const first = series[0];
  const last = series[series.length - 1];
  const returnRate = calculateReturnRate(first.price, last.price);
  if (returnRate === null) {
    throw new Error("insufficient_data");
  }

  const currency = String(result.meta?.currency || "TWD").toUpperCase();
  const fx = await resolveFxToTwd(currency);

  return {
    symbol,
    months,
    startDate: first.date,
    latestDate: last.date,
    startPrice: first.price,
    latestPrice: last.price,
    returnRate,
    currency,
    fxRate: fx.rate,
    fxPairSymbol: fx.pairSymbol,
    fxAsOf: fx.asOf,
    series: compactSeries(series, 220)
  };
}

async function resolveFxToTwd(currency) {
  if (!currency || currency === "TWD") {
    return { rate: 1, pairSymbol: null, asOf: null };
  }

  const pairSymbol = `${currency}TWD=X`;
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(pairSymbol)}`);
  url.searchParams.set("interval", "1d");
  url.searchParams.set("range", "5d");

  try {
    const payload = await fetchJson(url);
    const result = payload.chart?.result?.[0];
    if (!result || !Array.isArray(result.timestamp)) {
      return { rate: null, pairSymbol, asOf: null };
    }
    const timestamps = result.timestamp;
    const closes = result.indicators?.quote?.[0]?.close || [];
    let rate = Number(result.meta?.regularMarketPrice);
    let asOf = null;
    for (let index = closes.length - 1; index >= 0; index -= 1) {
      const candidate = Number(closes[index]);
      if (Number.isFinite(candidate) && candidate > 0) {
        if (!Number.isFinite(rate) || rate <= 0) {
          rate = candidate;
        }
        asOf = formatDate(new Date(timestamps[index] * 1000));
        break;
      }
    }
    if (!Number.isFinite(rate) || rate <= 0) {
      return { rate: null, pairSymbol, asOf: null };
    }
    return { rate, pairSymbol, asOf };
  } catch (error) {
    console.error("fx_lookup_failed", error);
    return { rate: null, pairSymbol, asOf: null };
  }
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "Mozilla/5.0"
    }
  });

  if (!response.ok) {
    throw new Error(`upstream_http_${response.status}`);
  }

  return response.json();
}

function toSearchResult(quote) {
  const symbol = String(quote.symbol || "").trim();
  const code = symbol.includes(".") ? symbol.split(".")[0] : symbol;
  const name = quote.longname || quote.shortname || quote.displayName || quote.name || symbol;
  return {
    name: String(name),
    symbol,
    code,
    exchange: String(quote.exchDisp || quote.exchange || quote.fullExchangeName || "N/A"),
    type: String(quote.quoteType || "EQUITY")
  };
}

function dedupeResults(results) {
  const seen = new Set();
  return results.filter((result) => {
    const key = result.symbol.toUpperCase();
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function scoreStock(stock, normalizedQuery) {
  const fields = [
    stock.name,
    stock.symbol,
    stock.code,
    ...(stock.aliases || [])
  ];

  return Math.max(...fields.map((field) => scoreField(field, normalizedQuery)));
}

function scoreField(rawField, query) {
  const field = normalizeSearchText(rawField);
  if (!field || !query) {
    return 0;
  }
  if (field === query) {
    return 100;
  }
  if (field.startsWith(query)) {
    return 82;
  }
  if (field.includes(query)) {
    return 66;
  }
  if (field.length >= 3 && query.includes(field)) {
    return 62;
  }

  if (isAsciiSearch(query) && query.length >= 3) {
    const bestDistance = Math.min(
      ...tokenizeSearchText(rawField).map((token) => levenshteinDistance(token, query))
    );
    if (bestDistance <= 1) {
      return 58;
    }
    if (query.length >= 6 && bestDistance <= 2) {
      return 44;
    }
  }

  return 0;
}

function levenshteinDistance(left, right) {
  if (!left || !right) {
    return Math.max(left.length, right.length);
  }

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function normalizeSearchText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s._,\-()]+/g, "");
}

function tokenizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter(Boolean);
}

function isAsciiSearch(value) {
  return /^[a-z0-9]+$/.test(value);
}

function compactSeries(series, limit) {
  if (series.length <= limit) {
    return series;
  }

  const step = (series.length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, index) => {
    const sourceIndex = Math.round(index * step);
    return series[sourceIndex];
  });
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}
