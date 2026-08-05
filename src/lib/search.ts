/**
 * 网络搜索
 * 1) 优先调用站点后端 /api/search
 * 2) 回退：DuckDuckGo Lite (HTML解析)
 * 3) 再回退：DuckDuckGo JSON API
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

async function ddgJson(query: string): Promise<string> {
  try {
    const res = await fetch(
      "https://api.duckduckgo.com/?q=" +
        encodeURIComponent(query) +
        "&format=json&no_html=1",
    );
    if (!res.ok) return "";
    const j = (await res.json()) as Record<string, unknown>;
    const out: string[] = [];
    if (j.AbstractText) out.push("- " + String(j.AbstractText).slice(0, 300));
    for (const t of ((j.RelatedTopics || []) as { Text?: string }[]).slice(
      0,
      6,
    )) {
      if (t.Text) out.push("- " + t.Text.replace(/<[^>]+>/g, "").slice(0, 200));
    }
    return out.join("\n");
  } catch {
    return "";
  }
}

export async function webSearch(query: string): Promise<string> {
  const b = await backendSearch(query);
  if (b) return b;
  const l = await ddgLite(query);
  if (l) return l;
  const j = await ddgJson(query);
  if (j) return j;
  return "- 未找到结果\n  请尝试更精确的关键词或直接输入网址";
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
