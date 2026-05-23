#!/usr/bin/env node
import {
  getMarketSymbolCacheStatus,
  refreshMarketSymbolCache,
  searchMarketSymbols
} from "../src/market-symbol-cache.js";

const command = process.argv[2] || "status";
const query = process.argv.slice(3).join(" ");

if (command === "status") {
  console.log(JSON.stringify(await getMarketSymbolCacheStatus(), null, 2));
} else if (command === "refresh") {
  const cache = await refreshMarketSymbolCache();
  console.log(JSON.stringify({
    ok: true,
    updatedAt: new Date(cache.updatedAt).toISOString(),
    sources: cache.sources,
    count: cache.items.length
  }, null, 2));
} else if (command === "search") {
  if (!query) {
    console.error("Usage: node scripts/refresh-market-cache.js search <query>");
    process.exit(1);
  }
  console.log(JSON.stringify(await searchMarketSymbols(query), null, 2));
} else {
  console.error("Usage: node scripts/refresh-market-cache.js [status|refresh|search <query>]");
  process.exit(1);
}
