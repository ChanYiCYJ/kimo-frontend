/**
 * 网络搜索 & 网页抓取模块
 * 参考 open-webSearch (https://github.com/Aas-ee/open-webSearch) 架构重构
 *
 * 架构：
 *   - SearchResult 统一类型
 *   - 每个搜索引擎实现统一签名 (query, limit) => SearchResult[]
 *   - searchMulti() 多引擎聚合搜索
 *   - webSearch() 保持向后兼容（返回格式化文本）
 *   - fetchWebContent() 增强网页抓取
 *   - fetchWebpage() 保持向后兼容
 *
 * 搜索引擎：
 *   1. backend  — /api/search（Vite proxy → 本地后端）
 *   2. duckduckgo — DuckDuckGo Lite HTML 版（浏览器直连）
 *   3. wikipedia — Wikipedia opensearch API（CORS 友好）
 *   4. brave     — Brave Search 抓取（需后端代理转接）
 *   5. ai        — AI 模型生成搜索结果（回退）
 *
 * 代理端点（通过 Vite proxy 或 Worker 转发到 api.yogofor.top）：
 *   /api/search        — 后端搜索
 *   /api/fetch         — 后端网页抓取
 *   /api/proxy/search  — 通用搜索代理（转发到各搜索引擎）
 *   /api/proxy/fetch   — 通用网页抓取代理
 */

// ======================== 类型定义 ========================

/** 搜索结果（与 open-webSearch SearchResult 对齐） */
export interface SearchResult {
  title: string;
  url: string;
  description: string;
  /** 来源站点名 */
  source: string;
  /** 搜索引擎名 */
  engine: string;
}

/** 网页抓取结果 */
export interface FetchWebContentResult {
  url: string;
  finalUrl: string;
  contentType: string;
  title: string;
  /** 抓取方式：direct(浏览器直连) | proxy(后端代理) */
  retrievalMethod: "direct" | "proxy";
  truncated: boolean;
  content: string;
}

/** 搜索引擎执行器签名 */
export type SearchEngineExecutor = (
  query: string,
  limit: number,
) => Promise<SearchResult[]>;

/** 多引擎搜索结果 */
export interface MultiSearchResult {
  query: string;
  engines: string[];
  totalResults: number;
  results: SearchResult[];
  partialFailures: Array<{ engine: string; message: string }>;
}

// ======================== 工具函数 ========================

const MAX_CHARS_DEFAULT = 30000;
const FETCH_TIMEOUT_MS = 8000;

/** 带超时的 fetch */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 规范化文本（去除多余空白） */
function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** HTML → 纯文本 */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** 从 URL 提取域名作为 source */
function extractSource(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** 去重 URL */
function dedupeByUrl(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return results.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });
}

// ======================== AI 配置读取 ========================

function getAICfg() {
  try {
    const bots = JSON.parse(localStorage.getItem("kimo_ai_bots") || "[]") as {
      endpoint: string;
      apiKey: string;
      model: string;
    }[];
    if (bots.length) return bots[0];
    const botCfg = JSON.parse(
      localStorage.getItem("kimo_ai_bot_config") || "null",
    );
    if (botCfg?.endpoint) return botCfg;
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith("kimo_ai_local_")) continue;
      const lc = JSON.parse(localStorage.getItem(k) || "null");
      if (lc?.endpoint && lc?.apiKey && lc?.model) {
        return { endpoint: lc.endpoint, apiKey: lc.apiKey, model: lc.model };
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

// ======================== 引擎 1：后端搜索 ========================

export async function searchBackend(
  query: string,
  limit: number,
): Promise<SearchResult[]> {
  try {
    const res = await fetchWithTimeout(
      `/api/search?q=${encodeURIComponent(query)}&limit=${limit}`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return [];
    const data = (await res.json().catch(() => null)) as
      | { items?: SearchResult[] }
      | SearchResult[]
      | null;
    const items: SearchResult[] = Array.isArray(data)
      ? data
      : Array.isArray(data?.items)
        ? data.items
        : [];
    return items.slice(0, limit).map((it) => ({
      title: it.title || "",
      url: it.url || "",
      description: it.description || "",
      source: it.source || extractSource(it.url || ""),
      engine: "backend",
    }));
  } catch {
    return [];
  }
}

// ======================== 引擎 2：DuckDuckGo Lite ========================

export async function searchDuckDuckGo(
  query: string,
  limit: number,
): Promise<SearchResult[]> {
  try {
    const res = await fetchWithTimeout(
      `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
    );
    if (!res.ok) return [];
    const html = await res.text();
    const results: SearchResult[] = [];

    const linkRegex =
      /<a[^>]*class="result-link"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
    const snippetRegex =
      /<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/g;

    const links = [...html.matchAll(linkRegex)];
    const snippets = [...html.matchAll(snippetRegex)];

    for (let i = 0; i < Math.min(links.length, snippets.length, limit); i++) {
      const title = (links[i]?.[2] || "").replace(/<[^>]+>/g, "").trim();
      const url = links[i]?.[1] || "";
      const description = (snippets[i]?.[1] || "")
        .replace(/<[^>]+>/g, "")
        .trim();
      if (title && url) {
        results.push({
          title,
          url,
          description,
          source: extractSource(url),
          engine: "duckduckgo",
        });
      }
    }
    return results;
  } catch {
    return [];
  }
}

// ======================== 引擎 3：Wikipedia ========================

export async function searchWikipedia(
  query: string,
  limit: number,
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];

  for (const lang of ["zh", "en"]) {
    try {
      const api = `https://${lang}.wikipedia.org/w/api.php`;
      const res = await fetchWithTimeout(
        `${api}?action=opensearch&format=json&origin=*&limit=${limit}&namespace=0&search=${encodeURIComponent(query)}`,
      );
      if (!res.ok) continue;
      const d = (await res.json()) as [string, string[], string[], string[]];
      const titles = (d[1] || []).filter(Boolean);
      const descs = d[2] || [];
      const urls = d[3] || [];
      if (!titles.length) continue;

      const extracts: Record<string, string> = {};
      try {
        const r2 = await fetchWithTimeout(
          `${api}?action=query&prop=extracts&exintro&explaintext&redirects=1&format=json&origin=*&titles=${encodeURIComponent(titles.join("|"))}`,
        );
        if (r2.ok) {
          const j2 = (await r2.json()) as {
            query?: {
              pages?: Record<string, { title?: string; extract?: string }>;
            };
          };
          for (const p of Object.values(j2.query?.pages || {})) {
            if (p.title && p.extract) extracts[p.title] = p.extract;
          }
        }
      } catch {
        /* ignore */
      }

      for (let i = 0; i < titles.length && results.length < limit; i++) {
        const title = titles[i];
        const url = urls[i] || "";
        const desc = (extracts[title] || descs[i] || "")
          .trim()
          .replace(/\s+/g, " ");
        if (title) {
          results.push({
            title,
            url,
            description: desc,
            source: `${lang}.wikipedia.org`,
            engine: "wikipedia",
          });
        }
      }
      if (results.length > 0) break;
    } catch {
      continue;
    }
  }
  return results.slice(0, limit);
}

// ======================== 引擎 4：Brave Search ========================

export async function searchBrave(
  query: string,
  limit: number,
): Promise<SearchResult[]> {
  try {
    const res = await fetchWithTimeout(
      `/api/proxy/search/brave?q=${encodeURIComponent(query)}&limit=${limit}`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return [];
    const data = await res.json().catch(() => null);
    if (!Array.isArray(data)) return [];
    return data.slice(0, limit);
  } catch {
    return searchBraveDirect(query, limit);
  }
}

async function searchBraveDirect(
  query: string,
  limit: number,
): Promise<SearchResult[]> {
  try {
    const res = await fetchWithTimeout(
      `https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "text/html",
        },
      },
    );
    if (!res.ok) return [];
    const html = await res.text();
    const results: SearchResult[] = [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    const snippets = doc.querySelectorAll("#results .snippet");
    for (const el of snippets) {
      if (results.length >= limit) break;
      const content = el.querySelector(".result-content");
      if (!content) continue;
      const mainLink = content.querySelector("> a");
      const url = mainLink?.getAttribute("href") || "";
      const title =
        mainLink?.querySelector(".search-snippet-title")?.textContent?.trim() ||
        "";
      const description =
        content
          .querySelector(".generic-snippet")
          ?.textContent?.trim()
          .replace(/\s+/g, " ") || "";

      if (title && url) {
        results.push({
          title,
          url,
          description,
          source: extractSource(url),
          engine: "brave",
        });
      }
    }
    return results;
  } catch {
    return [];
  }
}

// ======================== 引擎 5：AI 生成 ========================

export async function searchAI(
  query: string,
  limit: number,
): Promise<SearchResult[]> {
  try {
    const cfg = getAICfg();
    if (!cfg?.endpoint || !cfg?.apiKey || !cfg?.model) return [];
    const res = await fetchWithTimeout(
      cfg.endpoint.replace(/\/+$/, "") + "/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + cfg.apiKey,
        },
        body: JSON.stringify({
          model: cfg.model,
          messages: [
            {
              role: "system",
              content:
                "你是搜索引擎助手。用户查询后，请以JSON数组格式返回搜索结果，每条包含title、url、description字段。URL使用真实存在的网站链接。最多返回" +
                limit +
                "条。只返回JSON数组，不要其他内容。",
            },
            { role: "user", content: "查询：" + query },
          ],
          temperature: 0.3,
          max_tokens: 800,
          stream: false,
        }),
      },
    );
    if (!res.ok) return [];
    const j = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = j.choices?.[0]?.message?.content || "";
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.slice(0, limit).map((it: Record<string, string>) => ({
          title: it.title || "",
          url: it.url || "",
          description: it.description || "",
          source: extractSource(it.url || ""),
          engine: "ai",
        }));
      }
    } catch {
      /* fall through */
    }
    return parseTextResults(raw, limit).map((r) => ({ ...r, engine: "ai" }));
  } catch {
    return [];
  }
}

function parseTextResults(raw: string, limit: number): SearchResult[] {
  const results: SearchResult[] = [];
  const items = raw
    .split(/\n(?=(?:-\s|\d+[.、)]\s))/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const it of items) {
    if (results.length >= limit) break;
    let body = it.replace(/^(?:-\s|\d+[.、)]\s+)/, "").replace(/\*\*/g, "");
    const md = body.match(/\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/);
    const paren = body.match(/\(?(https?:\/\/[^\s)\]】>,;]+)/);
    let title = "";
    let url = "";
    if (md) {
      title = md[1].trim();
      url = md[2].replace(/[)\]】>]+$/, "");
      body = body.replace(/\[[^\]]*\]\(https?:\/\/[^\s)]+\)/, " ");
    } else if (paren) {
      url = paren[1];
      body = body.replace(/\(?https?:\/\/[^\s)\]】>,;]+\)?/, " ");
    }
    const lines = body
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const first = lines.shift() || "";
    if (!title) title = first.replace(/[\s()）【】\[\]—–-]+$/g, "").trim();
    const desc = lines.join(" ").replace(/\s+/g, " ").trim();
    if (title || url) {
      results.push({
        title: title || url,
        url: url || "",
        description: desc.slice(0, 300),
        source: extractSource(url),
        engine: "ai",
      });
    }
  }
  return results;
}

// ======================== 多引擎聚合搜索 ========================

export const SEARCH_ENGINES: Record<string, SearchEngineExecutor> = {
  backend: searchBackend,
  duckduckgo: searchDuckDuckGo,
  wikipedia: searchWikipedia,
  brave: searchBrave,
  ai: searchAI,
};

export async function searchMulti(
  query: string,
  engines: string[] = ["duckduckgo", "wikipedia"],
  limit: number = 10,
): Promise<MultiSearchResult> {
  const perEngineLimit = Math.max(
    3,
    Math.ceil(limit / Math.max(1, engines.length)),
  );
  const allResults: SearchResult[] = [];
  const partialFailures: MultiSearchResult["partialFailures"] = [];

  const settled = await Promise.allSettled(
    engines.map(async (name) => {
      const executor = SEARCH_ENGINES[name];
      if (!executor) {
        partialFailures.push({
          engine: name,
          message: `不支持的搜索引擎: ${name}`,
        });
        return [];
      }
      try {
        return await executor(query, perEngineLimit);
      } catch (e) {
        partialFailures.push({
          engine: name,
          message: e instanceof Error ? e.message : String(e),
        });
        return [];
      }
    }),
  );

  for (const s of settled) {
    if (s.status === "fulfilled") allResults.push(...s.value);
  }

  return {
    query,
    engines,
    totalResults: allResults.length,
    results: dedupeByUrl(allResults).slice(0, limit),
    partialFailures,
  };
}

export function formatResults(results: SearchResult[]): string {
  if (!results.length) return "- 未找到结果\n  请尝试更换关键词或确保AI已配置";
  return results
    .map((r) => `- ${r.title} (${r.url})\n  ${r.description.slice(0, 300)}`)
    .join("\n");
}

// ======================== 向后兼容：webSearch ========================

export async function webSearch(query: string): Promise<string> {
  const backend = await searchBackend(query, 6);
  if (backend.length) return formatResults(backend);

  const multi = await searchMulti(
    query,
    ["duckduckgo", "wikipedia", "brave"],
    6,
  );
  if (multi.results.length) return formatResults(multi.results);

  const ai = await searchAI(query, 6);
  if (ai.length) return formatResults(ai);

  return "- 未找到结果\n  请确保AI已配置，或尝试输入完整网址直接访问";
}

// ======================== 网页抓取 ========================

export async function fetchWebContent(
  url: string,
  maxChars: number = MAX_CHARS_DEFAULT,
): Promise<FetchWebContentResult> {
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) {
    throw new Error("仅支持 HTTP(S) 链接");
  }

  let retrievalMethod: "direct" | "proxy" = "proxy";
  let finalUrl = u;
  let raw = "";
  let contentType = "text/plain";

  try {
    const res = await fetchWithTimeout(
      `/api/fetch?url=${encodeURIComponent(u)}&maxChars=${maxChars}`,
      { headers: { Accept: "text/plain,application/json" } },
      15000,
    );
    if (res.ok) {
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("json")) {
        const j = await res.json();
        if (j?.content) {
          return {
            url: u,
            finalUrl: j.finalUrl || u,
            contentType: j.contentType || "text/html",
            title: j.title || "",
            retrievalMethod: "proxy",
            truncated: j.truncated || false,
            content: normalizeText(j.content),
          };
        }
      }
      raw = await res.text();
      if (raw && raw.trim().length > 40) {
        contentType = ct || "text/plain";
        retrievalMethod = "proxy";
      }
    }
  } catch {
    /* 代理不可用，回退直连 */
  }

  if (!raw) {
    try {
      const res = await fetchWithTimeout(
        u,
        {
          headers: {
            Accept: "text/html,text/plain,application/xhtml+xml",
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        },
        15000,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      finalUrl = res.url || u;
      contentType = res.headers.get("content-type") || "text/plain";
      raw = await res.text();
      retrievalMethod = "direct";
    } catch (e) {
      throw new Error(
        `无法抓取网页: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  let title = "";
  let content = "";

  if (contentType.includes("text/html") || raw.includes("<html")) {
    const doc = new DOMParser().parseFromString(raw, "text/html");
    title = doc.querySelector("title")?.textContent?.trim() || "";

    const selectors = [
      "article",
      "main",
      '[role="main"]',
      ".markdown-body",
      ".article-content",
      ".post-content",
      ".entry-content",
      ".content",
      "#content",
    ];
    for (const sel of selectors) {
      const el = doc.querySelector(sel);
      if (el && (el.textContent?.length || 0) >= 120) {
        content = htmlToText(el.innerHTML);
        break;
      }
    }
    if (!content) {
      doc
        .querySelectorAll("script, style, noscript, nav, footer, header")
        .forEach((e) => e.remove());
      content = htmlToText(doc.body?.innerHTML || raw);
    }
  } else {
    content = normalizeText(raw);
  }

  const truncated = content.length > maxChars;
  const finalContent = truncated
    ? content.slice(0, maxChars) +
      `\n\n[...truncated ${content.length - maxChars} characters]`
    : content;

  return {
    url: u,
    finalUrl,
    contentType,
    title,
    retrievalMethod,
    truncated,
    content: finalContent,
  };
}

export async function fetchWebpage(url: string): Promise<string> {
  try {
    const result = await fetchWebContent(url);
    return result.content;
  } catch {
    const u = url.trim();
    if (!/^https?:\/\//i.test(u)) return "";
    try {
      const res = await fetch(u, {
        headers: { Accept: "text/html,text/plain" },
      });
      if (!res.ok) return "";
      const html = await res.text();
      const text = htmlToText(html);
      return text.length > 40 ? normalizeText(text) : "";
    } catch {
      return "";
    }
  }
}

export function getAvailableEngines(): string[] {
  return Object.keys(SEARCH_ENGINES);
}
