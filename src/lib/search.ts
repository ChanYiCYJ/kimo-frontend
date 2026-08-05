/**
 * 网络搜索（客户端直连，无 API Key）
 * 1) 优先调用站点后端 /api/search（若后端实现了搜索代理，可绕过 CORS 与地域限制，国内站点也能用）
 * 2) 回退：维基百科（zh → en）。维基在部分地域（如中国大陆）可能不可达，此时返回空字符串并优雅降级。
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
      .slice(0, 4)
      .map((it) => `- ${it.title || ''}${it.url ? ` (${it.url})` : ''}\n  ${(it.description || it.snippet || '').slice(0, 300)}`)
      .filter(Boolean)
      .join('\n')
  } catch {
    return ''
  }
}

async function wikiSearch(query: string, langs: string[]): Promise<string> {
  for (const lang of langs) {
    try {
      const wiki = lang === 'zh' ? 'https://zh.wikipedia.org/w/api.php' : 'https://en.wikipedia.org/w/api.php'
      const searchUrl = `${wiki}?action=opensearch&search=${encodeURIComponent(query)}&limit=3&namespace=0&format=json&origin=*`
      const res = await fetch(searchUrl)
      if (!res.ok) continue
      const data = (await res.json()) as unknown[]
      const titles = (data[1] || []) as string[]
      const descs = (data[2] || []) as string[]
      const urls = (data[3] || []) as string[]

      const out: string[] = []
      for (let i = 0; i < Math.min(titles.length, 2); i++) {
        try {
          const extractUrl = `${wiki}?action=query&prop=extracts&exintro&explaintext&redirects=1&titles=${encodeURIComponent(titles[i])}&format=json&origin=*`
          const eres = await fetch(extractUrl)
          if (!eres.ok) continue
          const ej = (await eres.json()) as { query?: { pages?: Record<string, { extract?: string }> } }
          const pages = ej.query?.pages || {}
          const first = Object.values(pages)[0]
          const extract = first?.extract || descs[i] || ''
          out.push(`- ${titles[i]}${urls[i] ? ` (${urls[i]})` : ''}\n  ${extract.slice(0, 600)}`)
        } catch { /* 单条失败忽略 */ }
      }
      if (out.length) return out.join('\n')
    } catch { /* 换下一个来源 */ }
  }
  return ''
}

export async function webSearch(query: string, lang = 'zh'): Promise<string> {
  const backend = await backendSearch(query)
  if (backend) return backend
  return wikiSearch(query, [lang, lang === 'zh' ? 'en' : 'zh'])
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
