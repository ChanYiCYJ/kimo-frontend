import { articleApi, categoryApi } from './api'
import type { ArticleListItem, Category } from './types'

/**
 * 知识库（KB）：可选文章/分类 + 本机浏览器自定义笔记
 * - 站点内容选择按机器人（pageId）分开保存
 * - 自定义笔记保存在本机浏览器（localStorage），任何人都可添加，不依赖账号
 */

export interface KbNote {
  id: string
  title: string
  content: string
  createdAt: number
}

export interface KbSelections {
  articleIds: number[]
  categoryIds: number[]
  includeNotes: boolean
}

export interface KbOptions {
  articles: ArticleListItem[]
  categories: Category[]
}

const NOTES_KEY = 'kimo_kb_notes'
const SEL_PREFIX = 'kimo_kb_sel_'

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

// ---- 本机自定义笔记（浏览器级，所有机器人共享） ----
export function getKbNotes(): KbNote[] {
  try {
    const r = JSON.parse(localStorage.getItem(NOTES_KEY) || '[]')
    return Array.isArray(r) ? r : []
  } catch {
    return []
  }
}

export function saveKbNotes(notes: KbNote[]): void {
  try {
    localStorage.setItem(NOTES_KEY, JSON.stringify(notes))
  } catch { /* 忽略 */ }
}

export function addKbNote(title: string, content: string): KbNote[] {
  const notes = getKbNotes()
  const note: KbNote = { id: uid(), title: title.trim(), content: content.trim(), createdAt: Date.now() }
  notes.unshift(note)
  saveKbNotes(notes)
  return notes
}

export function updateKbNote(id: string, title: string, content: string): KbNote[] {
  const notes = getKbNotes().map((n) => (n.id === id ? { ...n, title: title.trim(), content: content.trim() } : n))
  saveKbNotes(notes)
  return notes
}

export function removeKbNote(id: string): KbNote[] {
  const notes = getKbNotes().filter((n) => n.id !== id)
  saveKbNotes(notes)
  return notes
}

// ---- 每个机器人的选择 ----
export function getKbSelections(pageId: number): KbSelections {
  try {
    const r = JSON.parse(localStorage.getItem(SEL_PREFIX + pageId) || '')
    if (r && Array.isArray(r.articleIds) && Array.isArray(r.categoryIds)) {
      return { articleIds: r.articleIds, categoryIds: r.categoryIds, includeNotes: r.includeNotes !== false }
    }
  } catch { /* 忽略 */ }
  return { articleIds: [], categoryIds: [], includeNotes: true }
}

export function saveKbSelections(pageId: number, sel: KbSelections): void {
  try {
    localStorage.setItem(SEL_PREFIX + pageId, JSON.stringify(sel))
  } catch { /* 忽略 */ }
}

// ---- 加载站点内容（翻页取全部文章） ----
export async function loadKbOptions(): Promise<KbOptions> {
  const [articles, categories] = await Promise.all([
    loadAllArticles(),
    categoryApi.list().catch(() => [] as Category[]),
  ])
  return { articles, categories }
}

async function loadAllArticles(): Promise<ArticleListItem[]> {
  const all: ArticleListItem[] = []
  try {
    let page = 1
    for (let i = 0; i < 20; i++) {
      const r = await articleApi.list(page)
      all.push(...r.items)
      if (r.items.length === 0 || all.length >= r.total || page >= r.total_page) break
      page++
    }
  } catch { /* 忽略 */ }
  return all
}

// ---- 组装知识库文本（发送时调用，已缓存到 AIChat） ----
export async function assembleKnowledge(sel: KbSelections, notes: KbNote[]): Promise<string> {
  const parts: string[] = []
  const { articles, categories } = await loadKbOptions()

  const selectedArticles = articles.filter((a) => sel.articleIds.includes(a.id))
  if (selectedArticles.length) {
    parts.push(
      '【文章】\n' + selectedArticles
        .map((a) => `- 《${a.title}》[${a.category_name || '未分类'}]：${a.description || ''}`)
        .join('\n'),
    )
  }

  const selectedCategories = categories.filter((c) => sel.categoryIds.includes(c.id))
  if (selectedCategories.length) {
    parts.push('【分类】\n' + selectedCategories.map((c) => `- ${c.name}(/${c.slug})`).join('\n'))
  }

  if (sel.includeNotes) {
    const valid = notes.filter((n) => n.title || n.content)
    if (valid.length) {
      parts.push('【自定义笔记】\n' + valid.map((n) => `- ${n.title}：${n.content}`).join('\n'))
    }
  }

  return parts.join('\n\n')
}

// ---- 导出知识库为 Markdown ----
export function downloadText(filename: string, text: string): void {
  const blob = new Blob(['\uFEFF' + text], { type: 'text/markdown;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}
