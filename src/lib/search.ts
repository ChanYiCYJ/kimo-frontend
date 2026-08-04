/**
 * 网络搜索：客户端直连 Wikipedia（CORS 友好，无需 API Key）
 * 搜索结果会作为上下文注入 AI 的系统提示词，让 AI 能回答最新/站外问题。
 */

interface WikiExtractPage {
  extract?: string
}

export async function webSearch(query: string, lang = 'zh'): Promise<string> {
  try {
    const wiki = lang === 'zh' ? 'https://zh.wikipedia.org/w/api.php' : 'https://en.wikipedia.org/w/api.php'
    const searchUrl = `${wiki}?action=opensearch&search=${encodeURIComponent(query)}&limit=3&namespace=0&format=json&origin=*`
    const res = await fetch(searchUrl)
    if (!res.ok) return ''
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
        const ej = (await eres.json()) as { query?: { pages?: Record<string, WikiExtractPage> } }
        const pages = ej.query?.pages || {}
        const first = Object.values(pages)[0]
        const extract = first?.extract || descs[i] || ''
        out.push(`- ${titles[i]}${urls[i] ? ` (${urls[i]})` : ''}\n  ${extract.slice(0, 600)}`)
      } catch { /* 单条失败忽略 */ }
    }
    return out.join('\n')
  } catch {
    return ''
  }
}
