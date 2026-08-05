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
  /** og:image 封面图（供 AI 文章插图） */
  ogImage?: string;
  /** 正文图片列表（worker /api/fetch 提取，含 og:image） */
  images?: string[];
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

// ======================== 引擎 1：后端搜索（多引擎代理） ========================

/**
 * 通过 /api/search（Worker 多引擎代理：bing/duckduckgo/wikipedia）搜索。
 * @param engines 逗号分隔，例如 "bing,duckduckgo"；省略走默认全引擎
 */
export async function searchBackend(
  query: string,
  limit: number,
  engines?: string,
): Promise<SearchResult[]> {
  try {
    const qs = new URLSearchParams({ q: query, limit: String(limit) });
    if (engines) qs.set("engines", engines);
    const res = await fetchWithTimeout(`/api/search?${qs.toString()}`, {
      headers: { Accept: "application/json" },
    });
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
      engine: it.engine || "backend",
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
  // 优先通过 Worker 代理（/api/search），解决浏览器 CORS 问题
  try {
    const res = await fetchWithTimeout(
      `/api/search?q=${encodeURIComponent(query)}&limit=${limit}&engines=duckduckgo`,
      { headers: { Accept: "application/json" } },
    );
    if (res.ok) {
      const data = await res.json().catch(() => null);
      if (Array.isArray(data) && data.length) {
        return data.slice(0, limit).map((it: Record<string, string>) => ({
          title: it.title || "",
          url: it.url || "",
          description: it.description || "",
          source: it.source || extractSource(it.url || ""),
          engine: it.engine || "duckduckgo",
        }));
      }
    }
  } catch {
    /* 代理不可用，回退直连 */
  }
  // 直连 DuckDuckGo Lite（仅在不跨域的环境中有效）
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
    // 尝试解析 JSON 数组（兼容 AI 用 ```json 代码块包裹的情况）
    try {
      const jsonText = raw
        .replace(/```json\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();
      const parsed = JSON.parse(jsonText);
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
            ogImage: j.ogImage || "",
            images: Array.isArray(j.images)
              ? j.images.filter(
                  (im: string) => /^https?:\/\//i.test(im) && !im.includes("data:"),
                )
              : [],
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

// ======================== 搜索 + 多结果内容抓取 ========================

/**
 * 增强搜索：获取搜索结果列表，并对前 maxSources 个来源抓取正文内容。
 * 返回「搜索结果列表 + 各来源内容摘要」，供 AI 筛选综合多个资料后作答。
 *
 * 格式（供 AI 参考，标注来源便于引用）：
 *   【搜索结果】
 *   1. 标题 (url) — 描述
 *   ...
 *   【来源内容 · N 个】
 *   来源1 (url)：正文摘要...
 *   ...
 */
export async function webSearchWithContent(
  query: string,
  maxSources: number = 3,
  perSourceChars: number = 2500,
): Promise<string> {
  // 1) 多引擎聚合搜索（backend/duckduckgo/wikipedia/brave）
  const multi = await searchMulti(
    query,
    ["backend", "duckduckgo", "wikipedia"],
    8,
  );
  if (!multi.results.length) {
    // 回退 AI 生成列表
    const ai = await searchAI(query, 6);
    if (ai.length) multi.results.push(...ai);
  }
  if (!multi.results.length) return "";

  const out: string[] = [];
  out.push("【搜索结果】");
  multi.results.slice(0, 8).forEach((r, i) => {
    out.push(
      `${i + 1}. ${r.title} (${r.url})\n   ${(r.description || "").slice(0, 200)}`,
    );
  });

  // 2) 对前 maxSources 个来源抓取正文（并发，单点失败不影响整体）
  const targets = dedupeByUrl(multi.results)
    .filter((r) => /^https?:\/\//i.test(r.url))
    .slice(0, maxSources);

  if (targets.length) {
    out.push(`\n【来源内容 · ${targets.length} 个】`);
    const contents = await Promise.allSettled(
      targets.map((t) =>
        fetchWebContent(t.url, perSourceChars).then((c) => ({
          url: t.url,
          title: c.title || t.title,
          content: c.content,
        })),
      ),
    );
    contents.forEach((s, i) => {
      if (s.status === "fulfilled" && s.value.content.trim()) {
        out.push(
          `\n来源${i + 1} (${s.value.url}${s.value.title ? " | " + s.value.title : ""})：\n${s.value.content.slice(0, perSourceChars)}`,
        );
      } else {
        out.push(`\n来源${i + 1} (${targets[i]?.url})：内容抓取失败或为空`);
      }
    });
  }

  return out.join("\n");
}

// ======================== AI 生成 markdown 文章（综合筛选） ========================

/** 从网页提取 og:image 封面图（优先经 Worker 代理，解决 CORS） */
async function extractOgImage(url: string): Promise<string> {
  try {
    const res = await fetchWithTimeout(
      `/api/fetch?url=${encodeURIComponent(url)}&maxChars=5000`,
      { headers: { Accept: "application/json" } },
      8000,
    );
    if (res.ok) {
      const j = (await res.json().catch(() => null)) as {
        ogImage?: string;
      } | null;
      if (j?.ogImage) return j.ogImage;
    }
  } catch {
    /* 代理不可用，回退直连 */
  }
  try {
    const res = await fetchWithTimeout(
      url,
      {
        headers: { Accept: "text/html" },
      },
      6000,
    );
    const html = await res.text();
    const m =
      html.match(
        /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i,
      ) ||
      html.match(
        /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i,
      );
    return m ? m[1].trim() : "";
  } catch {
    return "";
  }
}

/**
 * 深度搜索 + AI 综合筛选 → 标准 markdown 文章（含标题/分节/列表/引用/图片/来源）。
 * 流程：
 *   1. 多引擎搜索拿结果列表
 *   2. 对前 maxSources 个来源抓取正文 + 提取 og:image 封面
 *   3. 调用 AI 按标准格式筛选综合生成文章
 */
export async function webSearchToArticle(
  query: string,
  maxSources: number = 4,
  seedUrls: string[] = [],
): Promise<{ article: string; sources: SearchResult[] }> {
  const cfg = getAICfg();
  if (!cfg?.endpoint || !cfg?.apiKey || !cfg?.model) {
    return { article: "", sources: [] };
  }

  // 1) 来源：优先复用已抓取到的 URL（避免并发重复搜索被限流导致空结果），
  //    否则多引擎搜索
  let results: SearchResult[] = seedUrls.map((u) => {
    let host = "";
    try {
      host = new URL(u).hostname.replace(/^www\./i, "");
    } catch {
      host = u;
    }
    return {
      title: host,
      url: u,
      description: "",
      source: host,
      engine: "seed",
    };
  });
  if (!results.length) {
    const multi = await searchMulti(
      query,
      ["backend", "duckduckgo", "wikipedia"],
      10,
    );
    results = dedupeByUrl(multi.results);
    if (!results.length) {
      const ai = await searchAI(query, 6);
      results = dedupeByUrl(ai);
    }
  }
  if (!results.length) return { article: "", sources: results };

  // 2) 抓取正文 + 封面图（og:image 经 Worker 代理提取）
  const targets = results
    .filter((r) => /^https?:\/\//i.test(r.url))
    .slice(0, maxSources);
  const fetched = await Promise.allSettled(
    targets.map(async (t) => {
      let content = "";
      let image = "";
      let images: string[] = [];
      try {
        const c = await fetchWebContent(t.url, 2500);
        content = c.content;
        image = c.ogImage || "";
        images = (c.images || [])
          .filter((im) => /^https?:\/\//i.test(im) && !im.includes("data:"))
          .filter((u, i, a) => a.indexOf(u) === i);
      } catch {
        /* 单点失败不影响整体 */
      }
      if (!image) image = await extractOgImage(t.url);
      if (image && !images.includes(image)) images.unshift(image);
      return { url: t.url, title: t.title, content, image, images };
    }),
  );

  const sourcesBlock = fetched
    .map((s, i) => {
      if (s.status !== "fulfilled") return "";
      const f = s.value;
      const imgs = (f.images || [])
        .filter((u: string) => /^https?:\/\//i.test(u) && !u.includes("data:"))
        .slice(0, 4)
        .map((u: string) => `\n[图片]: ${u}`)
        .join("");
      return `来源${i + 1} (${f.url} | ${f.title})${imgs}：\n${(f.content || "").slice(0, 2500)}`;
    })
    .filter(Boolean)
    .join("\n\n");

  // 3) AI 综合筛选生成标准 markdown 文章
  const sys =
    "你是资深内容研究员。基于用户提供的【搜索结果】与【来源内容】，筛选、交叉验证并综合多个资料，" +
    "用**标准 Markdown 格式**生成一篇结构化文章。要求：\n" +
    "- 首行 H1 标题（中文，概括主题）\n" +
    "- 开头 2-3 句引言摘要（加粗要点）\n" +
    "- 用 H2 分节（3-5 节），每节用有序/无序列表或短段落呈现关键信息\n" +
    "- 若提供了来源图片（[图片]: URL），请把多张图片分布到文章各处（封面放 H1 标题后，其余每节各插 1 张），用 `![配图](图片URL)` 插入\n" +
    "- 引用事实时用 `> 引用` 块，末尾附「参考来源」列表（Markdown 链接）\n" +
    "- 安全合规：若主题涉及成人/敏感/争议内容，仅做客观克制的信息介绍，绝不输出露骨、色情、暴力、仇恨或违法违规内容；资料不足时如实说明\n" +
    "- 只输出文章正文，不要额外说明";
  const userMsg = `查询主题：${query}\n\n【搜索结果】\n${results
    .slice(0, 10)
    .map(
      (r, i) =>
        `${i + 1}. ${r.title} (${r.url})\n   ${r.description?.slice(0, 200)}`,
    )
    .join(
      "\n",
    )}\n\n【来源内容】\n${sourcesBlock || "(抓取失败，仅凭搜索结果)"}`;

  // 3) AI 综合筛选生成标准 markdown 文章（推理模型可能把 token 用尽在思考上，
  //    因此加大 max_tokens 并在 content 为空时自动重试一次）
  let article = "";
  const tryGenerate = async () => {
    try {
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
              { role: "system", content: sys },
              { role: "user", content: userMsg },
            ],
            temperature: 0.5,
            max_tokens: 4000,
            stream: false,
          }),
        },
        60000,
      );
      if (!res.ok) return "";
      const j = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      return (j.choices?.[0]?.message?.content || "").trim();
    } catch {
      return "";
    }
  };
  article = await tryGenerate();
  if (!article) article = await tryGenerate();

  // 多图增强：收集所有来源图片（og:image + 正文图），封面 1 张 + 各 H2 小节前各 1 张，最多共 3 张
  if (article) {
    const imgs = fetched
      .filter(
        (
          f,
        ): f is PromiseFulfilledResult<{
          url: string;
          title: string;
          content: string;
          image: string;
          images: string[];
        }> => f.status === "fulfilled",
      )
      .flatMap((f) =>
        (f.value.images.length
          ? f.value.images
          : f.value.image
            ? [f.value.image]
            : []
        ).filter((u: string) => /^https?:\/\//i.test(u) && !u.includes("data:")),
      )
      .filter((u, i, a) => a.indexOf(u) === i)
      .slice(0, 4);
    if (imgs.length) {
      // 1) 封面：H1 标题后（若文章还没有任何图）
      if (!article.includes("![") && /^#/.test(article)) {
        const nl = article.indexOf("\n");
        article =
          nl > 0
            ? article.slice(0, nl) +
              "\n\n![配图](" +
              imgs[0] +
              ")\n" +
              article.slice(nl)
            : article + "\n\n![配图](" + imgs[0] + ")";
      }
      // 2) 各 H2 小节前补图（从最后一个 H2 往前插保证索引有效；最多再补 2 张）
      const used = article.split("![").length - 1;
      const h2s = [...article.matchAll(/^##\s.+$/gm)].map((m) => m.index!);
      let added = 0;
      for (
        let k = h2s.length - 1;
        k >= 1 && added < 2 && used + added < imgs.length;
        k--
      ) {
        const img = imgs[used + added];
        article =
          article.slice(0, h2s[k]) +
          "\n\n![配图](" +
          img +
          ")\n" +
          article.slice(h2s[k]);
        added++;
      }
    }
  }
  return { article, sources: results };
}

// ======================== 搜索/文章历史缓存（避免重复生成） ========================

interface SearchCacheEntry {
  content: string;
  article: string;
  sources: SearchResult[];
  time: number;
  /** 生成中标记：命中时避免并发重复生成 */
  loading?: boolean;
}

const SEARCH_CACHE_KEY = "kimo_search_cache_v1";
const SEARCH_CACHE_MAX = 30;
const SEARCH_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 小时

function searchCacheKey(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80);
}

function loadSearchCache(): Record<string, SearchCacheEntry> {
  try {
    const r = JSON.parse(localStorage.getItem(SEARCH_CACHE_KEY) || "{}");
    return r && typeof r === "object" ? r : {};
  } catch {
    return {};
  }
}

function saveSearchCache(map: Record<string, SearchCacheEntry>): void {
  try {
    localStorage.setItem(SEARCH_CACHE_KEY, JSON.stringify(map));
  } catch {
    /* 忽略 */
  }
}

/** 读取搜索/文章缓存（命中且未过期返回内容；生成中返回 loading 标记） */
export function readSearchCache(
  query: string,
): (SearchCacheEntry & { cached: boolean }) | null {
  const map = loadSearchCache();
  const e = map[searchCacheKey(query)];
  if (!e) return null;
  // 生成中：返回 loading，不当作完成
  if (e.loading) return { ...e, cached: false, loading: true };
  // 过期清理
  if (Date.now() - e.time > SEARCH_CACHE_TTL) {
    delete map[searchCacheKey(query)];
    saveSearchCache(map);
    return null;
  }
  return { ...e, cached: true };
}

/** 写入缓存（保留最近 SEARCH_CACHE_MAX 条） */
export function writeSearchCache(
  query: string,
  entry: Partial<SearchCacheEntry>,
): void {
  const map = loadSearchCache();
  const key = searchCacheKey(query);
  const prev = map[key] || {};
  map[key] = { ...prev, ...entry, time: Date.now() };
  // 限制条数：超限删最旧
  const keys = Object.keys(map);
  if (keys.length > SEARCH_CACHE_MAX) {
    keys
      .sort((a, b) => (map[a].time || 0) - (map[b].time || 0))
      .slice(0, keys.length - SEARCH_CACHE_MAX)
      .forEach((k) => delete map[k]);
  }
  saveSearchCache(map);
}

/** 清除某条缓存 */
export function clearSearchCache(query?: string): void {
  const map = loadSearchCache();
  if (query) delete map[searchCacheKey(query)];
  else {
    Object.keys(map).forEach((k) => delete map[k]);
  }
  saveSearchCache(map);
}

/** 从已抓取的搜索内容里提取来源 URL（供文章生成复用，避免并发重复搜索） */
function extractSourceUrls(content: string, max = 4): string[] {
  if (!content) return [];
  const urls: string[] = [];
  const re = /https?:\/\/[^\s)\]】>]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) && urls.length < max) {
    const u = m[0].replace(/[)\]】>]+$/, "");
    if (/^https?:\/\//i.test(u) && !urls.includes(u)) urls.push(u);
  }
  return urls;
}

/**
 * 带缓存的深度搜索 + AI 文章（供浏览面板使用）：
 * - 命中缓存直接返回（不重复生成）
 * - 未命中则搜索+抓取+AI 生成，完成后自动写入历史
 * - 生成中标记 loading，避免并发重复生成
 */
export type SearchWithCacheResult = {
  content: string;
  article: string;
  sources: SearchResult[];
  time: number;
  cached: boolean;
  loading: boolean;
  fresh: boolean;
};

export async function searchWithCache(
  query: string,
  opts: { maxSources?: number; perSourceChars?: number } = {},
): Promise<SearchWithCacheResult> {
  const hit = readSearchCache(query);
  // 命中缓存：有文章（或没有内容）直接返回；有内容但文章为空（上次生成失败）→ 补生成文章，
  // 避免空文章长期占位导致永远不生成
  if (hit && (hit.article || !hit.content)) {
    return { ...hit, loading: !!hit.loading, fresh: false };
  }
  if (hit) {
    writeSearchCache(query, { loading: true });
    try {
      const articleRes = await webSearchToArticle(
        query,
        opts.maxSources ?? 4,
        extractSourceUrls(hit.content, opts.maxSources ?? 4),
      );
      const entry: SearchCacheEntry = {
        content: hit.content,
        article: articleRes.article || "",
        sources:
          articleRes.sources?.length > 0 ? articleRes.sources : hit.sources,
        time: Date.now(),
        loading: false,
      };
      writeSearchCache(query, entry);
      return { ...entry, loading: false, cached: true, fresh: false };
    } catch {
      writeSearchCache(query, { loading: false });
      return { ...hit, loading: false, cached: true, fresh: false };
    }
  }

  // 标记生成中（同关键词并发只生成一次）
  writeSearchCache(query, { loading: true });

  try {
    // 先抓内容，再复用其来源生成文章（串行：避免并发重复搜索被限流导致文章为空）
    const content = await webSearchWithContent(
      query,
      opts.maxSources ?? 3,
      opts.perSourceChars ?? 2500,
    );
    const articleRes = await webSearchToArticle(
      query,
      opts.maxSources ?? 4,
      extractSourceUrls(content, opts.maxSources ?? 4),
    );
    const entry: SearchCacheEntry = {
      content: content || "",
      article: articleRes.article || "",
      sources: articleRes.sources || [],
      time: Date.now(),
      loading: false,
    };
    writeSearchCache(query, entry);
    return { ...entry, loading: false, cached: false, fresh: true };
  } catch {
    writeSearchCache(query, { loading: false });
    return {
      content: "",
      article: "",
      sources: [],
      time: Date.now(),
      cached: false,
      loading: false,
      fresh: true,
    };
  }
}
