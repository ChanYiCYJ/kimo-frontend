/**
 * 网络搜索
 * 1) 优先后端 /api/search
 * 2) 回退：AI 生成搜索结果（使用训练数据）
 * 3) 再回退：DuckDuckGo Lite
 */

interface SearchItem {
  title?: string;
  url?: string;
  description?: string;
  snippet?: string;
}

// 获取 AI 配置（复用 getAIConfig）
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
    if (botCfg?.endpoint) return botCfg; // 回退：本机自定义 API（kimo_ai_local_{pageId}，与聊天实际生效配置一致）
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith("kimo_ai_local_")) continue;
      const lc = JSON.parse(localStorage.getItem(k) || "null");
      if (lc?.endpoint && lc?.apiKey && lc?.model) {
        return { endpoint: lc.endpoint, apiKey: lc.apiKey, model: lc.model };
      }
    }
  } catch {}
  return null;
}

async function backendSearch(query: string): Promise<string> {
  try {
    const res = await fetch("/api/search?q=" + encodeURIComponent(query), {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return "";
    const data = (await res.json().catch(() => null)) as
      | { items?: SearchItem[] }
      | SearchItem[]
      | null;
    const items = Array.isArray(data)
      ? data
      : Array.isArray(data?.items)
        ? data.items
        : null;
    if (!items || !items.length) return "";
    return items
      .slice(0, 6)
      .map(
        (it) =>
          "- " +
          (it.title || "") +
          (it.url ? " (" + it.url + ")" : "") +
          "\n  " +
          (it.description || it.snippet || "").slice(0, 300),
      )
      .join("\n");
  } catch {
    return "";
  }
}

/** 用 AI 模型生成搜索结果 */
async function aiSearch(query: string): Promise<string> {
  try {
    const cfg = getAICfg();
    if (!cfg?.endpoint || !cfg?.apiKey || !cfg?.model) return "";
    const res = await fetch(
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
                "你是搜索引擎助手。用户查询后，请以标准列表格式返回5-6条搜索结果，每条格式为：- 标题 (URL)\n  简短描述(不超过200字)。URL使用真实存在的网站链接。只返回搜索结果，不要其他内容。",
            },
            { role: "user", content: "查询：" + query },
          ],
          temperature: 0.3,
          max_tokens: 800,
          stream: false,
        }),
      },
    );
    if (!res.ok) return "";
    const j = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return normalizeSearch(j.choices?.[0]?.message?.content || "");
  } catch {
    return "";
  }
}

/** 将 AI 返回的搜索结果统一规范化为「- 标题 (URL)\n  描述」格式 */
function normalizeSearch(raw: string): string {
  if (!raw.trim()) return "";
  // 按列表项切分：支持 - / 1. / 1、/ 1) 等
  const items = raw
    .split(/\n(?=(?:-\s|\d+[.、)]\s))/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const it of items) {
    // 去掉列表前缀与 markdown 加粗
    let body = it.replace(/^(?:-\s|\d+[.、)]\s+)/, "").replace(/\*\*/g, "");
    // 提取 URL（含 (URL) 或裸 URL 或 markdown [t](u)）
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
      const line = (title || url) + (url ? " (" + url + ")" : "");
      out.push("- " + line + (desc ? "\n  " + desc.slice(0, 300) : ""));
    }
  }
  return out.join("\n");
}

async function ddgLite(query: string): Promise<string> {
  try {
    const res = await fetch(
      "https://lite.duckduckgo.com/lite/?q=" + encodeURIComponent(query),
    );
    if (!res.ok) return "";
    const html = await res.text();
    const links = [
      ...html.matchAll(
        /<a[^>]*class="result-link"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g,
      ),
    ];
    const snippets = [
      ...html.matchAll(/<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/g),
    ];
    const out: string[] = [];
    for (let i = 0; i < Math.min(links.length, snippets.length, 6); i++) {
      const title = (links[i]?.[2] || "").replace(/<[^>]+>/g, "").trim();
      const url = links[i]?.[1] || "";
      const desc = (snippets[i]?.[1] || "").replace(/<[^>]+>/g, "").trim();
      if (title)
        out.push(
          "- " +
            title +
            (url ? " (" + url + ")" : "") +
            "\n  " +
            desc.slice(0, 300),
        );
    }
    return out.join("\n");
  } catch {
    return "";
  }
}

/** 中文维基优先，回退英文维基（CORS origin=*，无需 key，海外可直连） */
async function wikiSearch(query: string): Promise<string> {
  const zh = await wikiLang(query, "zh");
  if (zh) return zh;
  return wikiLang(query, "en");
}

/** 维基百科 opensearch + 批量条目简介 */
async function wikiLang(query: string, lang: string): Promise<string> {
  const api = `https://${lang}.wikipedia.org/w/api.php`;
  try {
    const res = await fetch(
      api +
        "?action=opensearch&format=json&origin=*&limit=6&namespace=0&search=" +
        encodeURIComponent(query),
    );
    if (!res.ok) return "";
    const d = (await res.json()) as [string, string[], string[], string[]];
    const titles = (d[1] || []).filter(Boolean);
    const descs = d[2] || [];
    const urls = d[3] || [];
    if (!titles.length) return "";
    // 批量拉取条目简介（一条请求，intro 摘要）
    const extracts: Record<string, string> = {};
    try {
      const r2 = await fetch(
        api +
          "?action=query&prop=extracts&exintro&explaintext&redirects=1&format=json&origin=*&titles=" +
          encodeURIComponent(titles.join("|")),
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
    } catch {}
    const out: string[] = [];
    titles.forEach((title, i) => {
      const url = urls[i] || "";
      const desc = (extracts[title] || descs[i] || "")
        .trim()
        .replace(/\s+/g, " ");
      if (title)
        out.push(
          "- " +
            title +
            (url ? " (" + url + ")" : "") +
            (desc ? "\n  " + desc.slice(0, 300) : ""),
        );
    });
    return out.join("\n");
  } catch {
    return "";
  }
}

export async function webSearch(query: string): Promise<string> {
  const b = await backendSearch(query);
  if (b) return b;
  const a = await aiSearch(query);
  if (a) return a;
  const w = await wikiSearch(query);
  if (w) return w;
  const l = await ddgLite(query);
  if (l) return l;
  return "- 未找到结果\n  请确保AI已配置，或尝试输入完整网址直接访问";
}

export async function fetchWebpage(url: string): Promise<string> {
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return "";
  try {
    const res = await fetch("/api/fetch?url=" + encodeURIComponent(u), {
      headers: { Accept: "text/plain" },
    });
    if (res.ok) {
      const t = await res.text();
      if (t && t.trim().length > 40) return cleanPage(t);
    }
  } catch {}
  try {
    const res = await fetch(u, { headers: { Accept: "text/html,text/plain" } });
    if (!res.ok) return "";
    const html = await res.text();
    const text = htmlToText(html);
    return text.length > 40 ? cleanPage(text) : "";
  } catch {
    return "";
  }
}

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

function cleanPage(text: string): string {
  return text
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 8000);
}
