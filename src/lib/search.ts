/**
 * 网络搜索
 * 1) 优先后端 /api/search
 * 2) 回退：AI 生成搜索结果（使用训练数据）
 * 3) 再回退：DuckDuckGo Lite
 */

interface SearchItem { title?: string; url?: string; description?: string; snippet?: string; }

// 获取 AI 配置（复用 getAIConfig）
function getAICfg() {
  try {
    const bots = JSON.parse(localStorage.getItem("kimo_ai_bots") || "[]") as { endpoint: string; apiKey: string; model: string }[];
    if (bots.length) return bots[0];
    const botCfg = JSON.parse(localStorage.getItem("kimo_ai_bot_config") || "null");
    if (botCfg?.endpoint) return botCfg;
  } catch {}
  return null;
}

async function backendSearch(query: string): Promise<string> {
  try {
    const res = await fetch("/api/search?q=" + encodeURIComponent(query), { headers: { Accept: "application/json" } });
    if (!res.ok) return "";
    const data = (await res.json().catch(() => null)) as { items?: SearchItem[] } | SearchItem[] | null;
    const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : null;
    if (!items || !items.length) return "";
    return items.slice(0, 6).map(it => "- " + (it.title || "") + (it.url ? " (" + it.url + ")" : "") + "\n  " + (it.description || it.snippet || "").slice(0, 300)).join("\n");
  } catch { return ""; }
}

/** 用 AI 模型生成搜索结果 */
async function aiSearch(query: string): Promise<string> {
  try {
    const cfg = getAICfg();
    if (!cfg?.endpoint || !cfg?.apiKey || !cfg?.model) return "";
    const res = await fetch(cfg.endpoint.replace(/\/+$/, "") + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.apiKey },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: "system", content: "你是搜索引擎助手。用户查询后，请以标准列表格式返回5-6条搜索结果，每条格式为：- 标题 (URL)\n  简短描述(不超过200字)。URL使用真实存在的网站链接。只返回搜索结果，不要其他内容。" },
          { role: "user", content: "查询：" + query }
        ],
        temperature: 0.3, max_tokens: 800, stream: false,
      }),
    });
    if (!res.ok) return "";
    const j = await res.json() as { choices?: { message?: { content?: string } }[] };
    return j.choices?.[0]?.message?.content || "";
  } catch { return ""; }
}

async function ddgLite(query: string): Promise<string> {
  try {
    const res = await fetch("https://lite.duckduckgo.com/lite/?q=" + encodeURIComponent(query));
    if (!res.ok) return "";
    const html = await res.text();
    const links = [...html.matchAll(/<a[^>]*class="result-link"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)];
    const snippets = [...html.matchAll(/<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/g)];
    const out: string[] = [];
    for (let i = 0; i < Math.min(links.length, snippets.length, 6); i++) {
      const title = (links[i]?.[2] || "").replace(/<[^>]+>/g, "").trim();
      const url = links[i]?.[1] || "";
      const desc = (snippets[i]?.[1] || "").replace(/<[^>]+>/g, "").trim();
      if (title) out.push("- " + title + (url ? " (" + url + ")" : "") + "\n  " + desc.slice(0, 300));
    }
    return out.join("\n");
  } catch { return ""; }
}

export async function webSearch(query: string): Promise<string> {
  const b = await backendSearch(query); if (b) return b;
  const a = await aiSearch(query); if (a) return a;
  const l = await ddgLite(query); if (l) return l;
  return "- 未找到结果\n  请确保AI已配置，或尝试输入完整网址直接访问";
}

export async function fetchWebpage(url: string): Promise<string> {
  const u = url.trim(); if (!/^https?:\/\//i.test(u)) return "";
  try {
    const res = await fetch("/api/fetch?url=" + encodeURIComponent(u), { headers: { Accept: "text/plain" } });
    if (res.ok) { const t = await res.text(); if (t && t.trim().length > 40) return cleanPage(t); }
  } catch {}
  try {
    const res = await fetch(u, { headers: { Accept: "text/html,text/plain" } });
    if (!res.ok) return "";
    const html = await res.text(); const text = htmlToText(html);
    return text.length > 40 ? cleanPage(text) : "";
  } catch { return ""; }
}

function htmlToText(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim();
}

function cleanPage(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trim().slice(0, 8000);
}
