import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const defaultCachePath = join(rootDir, ".cache", "market-symbols.json");
const defaultTtlMs = 24 * 60 * 60 * 1000;

const symbolAliasOverrides = new Map([
  ["5274.TWO", ["ASPEED", "Aspeed Technology", "ASPEED Technology", "信驊科技"]]
]);

let memoryCache = null;

export async function searchMarketSymbols(query, options = {}) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return [];
  }

  const cache = await loadMarketSymbolCache(options);
  return cache.items
    .map((item) => ({
      item,
      score: scoreMarketSymbol(item, normalizedQuery)
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.item.symbol.localeCompare(right.item.symbol))
    .slice(0, options.limit || 12)
    .map((entry) => ({
      name: entry.item.displayName || entry.item.name || entry.item.symbol,
      symbol: entry.item.symbol,
      code: entry.item.code,
      exchange: entry.item.exchange,
      type: entry.item.type || "EQUITY",
      source: "market-cache",
      confidence: entry.score
    }));
}

export async function getMarketSymbolCacheStatus(options = {}) {
  const cachePath = options.cachePath || process.env.MARKET_SYMBOL_CACHE || defaultCachePath;
  const diskCache = await readDiskCache(cachePath);
  if (!diskCache) {
    return {
      exists: false,
      cachePath,
      updatedAt: null,
      ageMs: null,
      sources: null,
      count: 0
    };
  }

  return {
    exists: true,
    cachePath,
    updatedAt: new Date(diskCache.updatedAt).toISOString(),
    ageMs: Date.now() - diskCache.updatedAt,
    sources: diskCache.sources || null,
    count: Array.isArray(diskCache.items) ? diskCache.items.length : 0
  };
}

export async function loadMarketSymbolCache(options = {}) {
  const cachePath = options.cachePath || process.env.MARKET_SYMBOL_CACHE || defaultCachePath;
  const ttlMs = Number(options.ttlMs ?? process.env.MARKET_SYMBOL_CACHE_TTL_MS ?? defaultTtlMs);
  const now = Date.now();

  if (memoryCache && memoryCache.cachePath === cachePath && now - memoryCache.updatedAt < ttlMs) {
    return memoryCache;
  }

  const diskCache = await readDiskCache(cachePath);
  if (diskCache && now - diskCache.updatedAt < ttlMs) {
    memoryCache = withAliasOverrides({ ...diskCache, cachePath });
    return memoryCache;
  }

  try {
    const refreshed = await refreshMarketSymbolCache(cachePath);
    memoryCache = withAliasOverrides({ ...refreshed, cachePath });
    return memoryCache;
  } catch (error) {
    if (diskCache) {
      console.error("market_symbol_cache_refresh_failed_using_stale_cache", error);
      memoryCache = withAliasOverrides({ ...diskCache, cachePath });
      return memoryCache;
    }
    console.error("market_symbol_cache_refresh_failed", error);
    memoryCache = { updatedAt: 0, items: [], cachePath };
    return memoryCache;
  }
}

export async function refreshMarketSymbolCache(cachePath = defaultCachePath) {
  const [twseItems, tpexItems, usItems] = await Promise.all([
    fetchTwseSymbols(),
    fetchTpexSymbols(),
    fetchUsSymbols()
  ]);

  const cache = {
    version: 1,
    updatedAt: Date.now(),
    sources: {
      twse: twseItems.length,
      tpex: tpexItems.length,
      us: usItems.length
    },
    items: dedupeItems([...twseItems, ...tpexItems, ...usItems])
  };

  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
  memoryCache = withAliasOverrides({ ...cache, cachePath });
  return cache;
}

async function readDiskCache(cachePath) {
  try {
    const payload = JSON.parse(await readFile(cachePath, "utf8"));
    if (!Array.isArray(payload.items) || !Number.isFinite(payload.updatedAt)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

async function fetchTwseSymbols() {
  const payload = await fetchJson("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL");
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload
    .map((row) => ({
      code: String(row.Code || "").trim().toUpperCase(),
      displayName: String(row.Name || "").trim(),
      name: String(row.Name || "").trim(),
      symbol: `${String(row.Code || "").trim().toUpperCase()}.TW`,
      exchange: "Taiwan Stock Exchange",
      type: "EQUITY",
      aliases: []
    }))
    .filter((item) => isTaiwanCode(item.code) && item.name);
}

async function fetchTpexSymbols() {
  const payload = await fetchJson("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes");
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload
    .map((row) => ({
      code: String(row.SecuritiesCompanyCode || "").trim().toUpperCase(),
      displayName: String(row.CompanyName || "").trim(),
      name: String(row.CompanyName || "").trim(),
      symbol: `${String(row.SecuritiesCompanyCode || "").trim().toUpperCase()}.TWO`,
      exchange: "Taipei Exchange",
      type: "EQUITY",
      aliases: []
    }))
    .filter((item) => isTaiwanCode(item.code) && item.name);
}

async function fetchUsSymbols() {
  const payload = await fetchJson("https://api.nasdaq.com/api/screener/stocks?tableonly=true&download=true");
  const rows = payload?.data?.rows;
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows
    .map((row) => {
      const symbol = normalizeUsSymbol(row.symbol);
      return {
        code: symbol,
        displayName: String(row.name || "").trim(),
        name: String(row.name || "").trim(),
        symbol,
        exchange: row.exchange ? String(row.exchange) : "US Market",
        type: "EQUITY",
        aliases: []
      };
    })
    .filter((item) => /^[A-Z]{1,5}(-[A-Z])?$/.test(item.symbol) && item.name);
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "Mozilla/5.0"
    }
  });
  if (!response.ok) {
    throw new Error(`market_symbol_source_http_${response.status}`);
  }
  return response.json();
}

function dedupeItems(items) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const key = item.symbol.toUpperCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(applyAliasOverrides(item));
  }
  return output;
}

function applyAliasOverrides(item) {
  const aliases = symbolAliasOverrides.get(item.symbol.toUpperCase());
  if (!aliases) {
    return item;
  }
  return {
    ...item,
    aliases: [...new Set([...(item.aliases || []), ...aliases])]
  };
}

function withAliasOverrides(cache) {
  return {
    ...cache,
    items: (cache.items || []).map(applyAliasOverrides)
  };
}

function scoreMarketSymbol(item, normalizedQuery) {
  const fields = [
    item.symbol,
    item.code,
    item.displayName,
    item.name,
    ...(item.aliases || [])
  ];

  let best = 0;
  for (const rawField of fields) {
    const field = normalizeSearchText(rawField);
    if (!field) {
      continue;
    }
    if (field === normalizedQuery) {
      best = Math.max(best, 96);
    } else if (field.startsWith(normalizedQuery)) {
      best = Math.max(best, 82);
    } else if (field.includes(normalizedQuery)) {
      best = Math.max(best, 70);
    } else if (field.length >= 4 && normalizedQuery.length >= 4 && normalizedQuery.includes(field)) {
      best = Math.max(best, 62);
    }
  }
  return best;
}

function normalizeSearchText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s._,\-()'"/]+/g, "");
}

function normalizeUsSymbol(symbol) {
  return String(symbol || "").trim().toUpperCase().replace(/[./]/g, "-");
}

function isTaiwanCode(code) {
  return /^\d{3,6}[A-Z]{0,2}$/.test(code);
}
