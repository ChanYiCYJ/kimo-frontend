/**
 * 网络搜索（国内合规优先）
 * 1) 优先调用站点后端 /api/search（绕过 CORS，国内可用）
 * 2) 回退：Bing 中国 cn.bing.com（合规）
 */

interface SearchItem {
  title?: string
  url?: string
  description?: string
  snippet?: string
}

async function backendSearch(query: string): Promise<string> {
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return ''
    const data = (await res.json().catch(() => null)) as { items?: SearchItem[] } | SearchItem[] | null
    const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : null
    if (!items || !items.length) return ''
    return items
      .slice(0, 6)
      .map((it) => `- ${it.title || ''}${it.url ? ` (${it.url})` : ''}\n  ${(it.description || it.snippet || '').slice(0, 300)}`)
      .filter(Boolean)
      .join('\n')
  } catch {
    return ''
  }
}

/** Bing 中国搜索回退（HTML 解析） */
async function bingSearch(query: string): Promise<string> {
  try {
    const res = await fetch(`https://cn.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-cn`, {
      headers: { 'Accept': 'text/html', 'User-Agent': 'Mozilla/5.0' },
    })
    if (!res.ok) return ''
    const html = await res.text()
    // 解析 Bing 搜索结果
    const results: string[] = []
    const items = html.match(/<li class="b_algo"[^>]*>[\s\S]*?<\/li>/gi) || []
    for (const item of items.slice(0, 6)) {
      const title = (item.match(/<h2[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/) || [])[1]?.replace(/<[^>]+>/g, '').trim()
      const url = (item.match(/href="(https?:\/\/[^"]+)"/) || [])[1]
      const desc = (item.match(/<p[^>]*>([\s\S]*?)<\/p>/) || [])[1]?.replace(/<[^>]+>/g, '').trim()
      if (title) results.push(`- ${title}${url ? ` (${url})` : ''}\n  ${(desc || '').slice(0, 300)}`)
    }
    return results.join('\n')
  } catch { return '' }
}

export async function webSearch(query: string, _lang?: string): Promise<string> {
  const backend = await backendSearch(query)
  if (backend) return backend
  return bingSearch(query)
}

/** 抓取网页正文文本（供 AI 浏览网页）。优先走后端代理，避免 CORS。 */
export async function fetchWebpage(url: string): Promise<string> {
  const u = url.trim()
  if (!/^https?:\/\//i.test(u)) return ''
  try {
    // 后端代理：/api/fetch?url=...（若后端实现）
    const res = await fetch(`/api/fetch?url=${encodeURIComponent(u)}`, {
      headers: { Accept: 'text/plain' },
    })
    if (res.ok) {
      const text = await res.text()
      if (text && text.trim().length > 40) return cleanPage(text)
    }
  } catch { /* 走直连回退 */ }

  // 直连回退（受 CORS 限制，很多站点不可用）
  try {
    const res = await fetch(u, { headers: { Accept: 'text/html,text/plain' } })
    if (!res.ok) return ''
    const html = await res.text()
    const text = htmlToText(html)
    return text.length > 40 ? cleanPage(text) : ''
  } catch {
    return ''
  }
}

/** 简易 HTML → 纯文本（去脚本/样式/标签） */
function htmlToText(html: string): string {
  const doc = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
  return doc
}

function cleanPage(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 4000)
}
