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

// ================= AI 工具调用解析：创建/编辑知识库 =================
// AI 回复格式：
//   [KB-SAVE:标题]内容[/KB-SAVE]   —— 新建或按标题更新一条知识库
//   [KB-EDIT:标题]新内容[/KB-EDIT] —— 修改已有知识库条目（按标题匹配）
export interface KbToolCmd {
  mode: 'save' | 'edit'
  title: string
  content: string
}

export function parseKbTool(reply: string): KbToolCmd | null {
  const saveM = reply.match(
    /\[KB-SAVE:\s*([^\]]+)\]\s*([\s\S]*?)\s*\[\/KB-SAVE\]/,
  )
  if (saveM) {
    return { mode: 'save', title: saveM[1].trim(), content: saveM[2].trim() }
  }
  const editM = reply.match(
    /\[KB-EDIT:\s*([^\]]+)\]\s*([\s\S]*?)\s*\[\/KB-EDIT\]/,
  )
  if (editM) {
    return { mode: 'edit', title: editM[1].trim(), content: editM[2].trim() }
  }
  return null
}

/** 按标题（忽略大小写/首尾空格）在笔记列表中找到条目 */
export function findKbNoteByTitle(
  notes: KbNote[],
  title: string,
): KbNote | undefined {
  const t = title.trim().toLowerCase()
  return notes.find((n) => n.title.trim().toLowerCase() === t)
}

// ---- 知识条目存储（与 AgentPanel 同构：kimo_kb_entries 为准 + 同步 kimo_kb_notes）----
export interface KbEntryRecord {
  id: string
  name: string
  content: string
  createdAt: number
}

const ENTRIES_KEY = 'kimo_kb_entries'

export function loadKbEntries(): KbEntryRecord[] {
  try {
    const r = JSON.parse(localStorage.getItem(ENTRIES_KEY) || '[]')
    return Array.isArray(r) ? r : []
  } catch {
    return []
  }
}

/**
 * AI 创建/编辑知识库条目（按标题匹配，命中则更新，否则新建）。
 * 同步写 kimo_kb_entries 与 kimo_kb_notes，返回目标条目。
 */
export function saveKbEntry(
  title: string,
  content: string,
): KbEntryRecord {
  const entries = loadKbEntries()
  const t = title.trim()
  const existing = entries.find(
    (e) => e.name.trim().toLowerCase() === t.toLowerCase(),
  )
  let entry: KbEntryRecord
  let next: KbEntryRecord[]
  if (existing) {
    entry = { ...existing, content }
    next = entries.map((e) => (e.id === existing.id ? entry : e))
  } else {
    entry = { id: uid(), name: t, content, createdAt: Date.now() }
    next = [entry, ...entries]
  }
  try {
    localStorage.setItem(ENTRIES_KEY, JSON.stringify(next))
  } catch {
    /* 忽略 */
  }
  saveKbNotes(
    next.map((e) => ({
      id: e.id,
      title: e.name,
      content: e.content,
      createdAt: e.createdAt,
    })),
  )
  return entry
}

// ================= 编辑器临时草稿（本机存储，非知识条目） =================
export interface KbDraft {
  id: string
  name: string
  content: string
  createdAt: number
}

const DRAFTS_KEY = 'kimo_editor_drafts'

export function loadEditorDrafts(): KbDraft[] {
  try {
    const r = JSON.parse(localStorage.getItem(DRAFTS_KEY) || '[]')
    return Array.isArray(r) ? r : []
  } catch {
    return []
  }
}

/** 保存一份临时草稿（同一名字会覆盖），返回最新列表 */
export function addEditorDraft(content: string, name?: string): KbDraft[] {
  const draft: KbDraft = {
    id: uid(),
    name:
      (name && name.trim()) ||
      '草稿 ' + new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
    content,
    createdAt: Date.now(),
  }
  const next = [draft, ...loadEditorDrafts()].slice(0, 20)
  try {
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(next))
  } catch { /* 忽略 */ }
  return next
}

export function removeEditorDraft(id: string): KbDraft[] {
  const next = loadEditorDrafts().filter((d) => d.id !== id)
  try {
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(next))
  } catch { /* 忽略 */ }
  return next
}
