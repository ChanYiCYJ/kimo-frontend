/**
 * 网络搜索
 * 1) 优先调用站点后端 /api/search
 * 2) 回退：DuckDuckGo Instant Answer API（支持 CORS）
 */

interface SearchItem {
  title?: string;
  url?: string;
  description?: string;
  snippet?: string;
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

/** DuckDuckGo Instant Answer（支持CORS，无需API Key） */
async function ddgSearch(query: string): Promise<string> {
  try {
    const u =
      "https://api.duckduckgo.com/?q=" +
      encodeURIComponent(query) +
      "&format=json&no_html=1&skip_disambig=1";
    const res = await fetch(u);
    if (!res.ok) return "";
    const j = (await res.json()) as Record<string, unknown>;
    const results: string[] = [];
    // RelatedTopics
    const topics = (j.RelatedTopics || []) as {
      Text?: string;
      FirstURL?: string;
    }[];
    for (const t of topics.slice(0, 6)) {
      if (t.Text) {
        const text = t.Text.replace(/<[^>]+>/g, "").trim();
        results.push(
          "- " +
            text.slice(0, 200) +
            (t.FirstURL ? " (" + t.FirstURL + ")" : ""),
        );
      }
    }
    // Abstract
    if (!results.length && j.AbstractText) {
      results.push(
        "- " +
          String(j.AbstractText).slice(0, 300) +
          (j.AbstractURL ? " (" + j.AbstractURL + ")" : ""),
      );
    }
    return results.join("\n");
  } catch {
    return "";
  }
}

export async function webSearch(query: string): Promise<string> {
  // 1) 后端搜索代理
  const backend = await backendSearch(query);
  if (backend) return backend;
  // 2) DuckDuckGo
  const ddg = await ddgSearch(query);
  if (ddg) return ddg;
  // 3) 无结果提示
  return "- 未找到相关结果\n  请尝试更精确的关键词，或直接输入网址获取网页内容";
}

/** 抓取网页正文文本（供 AI 浏览网页）。优先走后端代理，避免 CORS。 */
export async function fetchWebpage(url: string): Promise<string> {
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return "";
  try {
    // 后端代理：/api/fetch?url=...（若后端实现）
    const res = await fetch(`/api/fetch?url=${encodeURIComponent(u)}`, {
      headers: { Accept: "text/plain" },
    });
    if (res.ok) {
      const text = await res.text();
      if (text && text.trim().length > 40) return cleanPage(text);
    }
  } catch {
    /* 走直连回退 */
  }

  // 直连回退（受 CORS 限制，很多站点不可用）
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

/** 简易 HTML → 纯文本（去脚本/样式/标签） */
function htmlToText(html: string): string {
  const doc = html
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
    .replace(/\s+/g, " ");
  return doc;
}

function cleanPage(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 4000);
}
