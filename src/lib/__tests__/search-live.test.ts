/**
 * 搜索模块连接测试脚本
 * 用法：npx tsx src/lib/__tests__/search-live.test.ts
 * 测试各搜索引擎和网页抓取功能
 */
import {
  searchDuckDuckGo,
  searchWikipedia,
  searchBrave,
  searchMulti,
  fetchWebContent,
  type SearchResult,
} from "../search.js";

function logResults(label: string, results: SearchResult[]): void {
  console.log(`\n--- ${label} (${results.length} 条) ---`);
  results.slice(0, 5).forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.title}`);
    console.log(`     URL: ${r.url}`);
    console.log(`     Desc: ${(r.description || "").slice(0, 100)}`);
    console.log(`     Engine: ${r.engine} | Source: ${r.source}`);
  });
}

async function testSearch(query: string) {
  console.log(`\n🔍 测试搜索: "${query}"`);
  console.log("=".repeat(50));

  // 1) DuckDuckGo
  try {
    const start = Date.now();
    const ddg = await searchDuckDuckGo(query, 5);
    logResults(`DuckDuckGo (${Date.now() - start}ms)`, ddg);
  } catch (e) {
    console.log(`  DuckDuckGo ❌ ${e}`);
  }

  // 2) Wikipedia
  try {
    const start = Date.now();
    const wiki = await searchWikipedia(query, 5);
    logResults(`Wikipedia (${Date.now() - start}ms)`, wiki);
  } catch (e) {
    console.log(`  Wikipedia ❌ ${e}`);
  }

  // 3) Brave
  try {
    const start = Date.now();
    const brave = await searchBrave(query, 5);
    logResults(`Brave (${Date.now() - start}ms)`, brave);
  } catch (e) {
    console.log(`  Brave ❌ ${e}`);
  }

  // 4) Multi-engine
  try {
    const start = Date.now();
    const multi = await searchMulti(query, ["duckduckgo", "wikipedia"], 8);
    console.log(`\n--- searchMulti (${Date.now() - start}ms) ---`);
    console.log(
      `  Total: ${multi.totalResults} | Engines: ${multi.engines.join(", ")}`,
    );
    if (multi.partialFailures.length) {
      console.log(`  Failures:`, multi.partialFailures);
    }
    logResults("Multi Results", multi.results);
  } catch (e) {
    console.log(`  searchMulti ❌ ${e}`);
  }
}

async function testFetch(url: string) {
  console.log(`\n📄 测试抓取: "${url}"`);
  console.log("=".repeat(50));
  try {
    const start = Date.now();
    const result = await fetchWebContent(url, 2000);
    console.log(`  Status: OK (${Date.now() - start}ms)`);
    console.log(`  Title: ${result.title || "(无)"}`);
    console.log(`  Method: ${result.retrievalMethod}`);
    console.log(`  Content-Type: ${result.contentType}`);
    console.log(`  Truncated: ${result.truncated}`);
    console.log(`  Content (前 300 字): ${result.content.slice(0, 300)}`);
  } catch (e) {
    console.log(`  ❌ ${e}`);
  }
}

async function main() {
  console.log("🚀 Kimo Search Module — 连接测试");
  console.log("=".repeat(50));

  await testSearch("TypeScript tutorial");
  await testSearch("React hooks 最佳实践");
  await testSearch("open web search MCP");

  await testFetch("https://example.com");
  await testFetch("https://en.wikipedia.org/wiki/Web_search_engine");

  console.log("\n✅ 测试完成");
}

main().catch(console.error);
