// ===== API 客户端（对接 kimo-fastapi）=====
// - 统一响应结构 { code, message, data } 自动解包
// - 自动携带 JWT（localStorage 持久化）
// - 后端不可用 / 演示模式（VITE_USE_MOCK=1）时自动回退到演示数据
import { mockApi } from './mock'
import type {
  ArticleDetail,
  ArticleListItem,
  ArticleListResult,
  ArticlePayload,
  Category,
  CategoryPayload,
  Page,
  PagePayload,
  SiteSettings,
  Tag,
  TokenResult,
  UploadResult,
  User,
} from './types'

export const API_BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api/v1'

/** 是否强制演示模式 */
const MOCK_MODE = import.meta.env.VITE_USE_MOCK === '1'

const TOKEN_KEY = 'kimo_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}
export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status = 0) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** 网络层错误（含 Vite 代理在后端未启动时的 500/502） */
function isNetworkError(e: unknown): boolean {
  if (e instanceof TypeError) return true
  if (e instanceof ApiError && e.status >= 500) return true
  return false
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string>) ?? {}),
  }
  const isForm = options.body instanceof FormData
  if (!isForm && options.body != null && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, { ...options, headers })
  } catch {
    throw new TypeError('network error')
  }

  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    /* 非 JSON（代理错误页） */
  }

  if (!res.ok) {
    // 后端未启动：Vite 代理返回 500/502 文本错误
    if (res.status >= 500 && body === null) {
      throw new TypeError('backend unavailable')
    }
    const obj = body as { detail?: string; message?: string } | null
    throw new ApiError(obj?.detail ?? obj?.message ?? `请求失败 (${res.status})`, res.status)
  }

  // 统一响应解包
  if (body && typeof body === 'object' && 'data' in (body as object)) {
    const env = body as { code?: number; message?: string; data?: T }
    if (typeof env.code === 'number' && env.code !== 0) {
      throw new ApiError(env.message || '请求失败', res.status)
    }
    return env.data as T
  }
  return body as T
}

/** 带演示数据回退的请求 */
async function call<T>(fn: () => Promise<T>, fb: () => Promise<T>): Promise<T> {
  if (MOCK_MODE) return fb()
  try {
    return await fn()
  } catch (e) {
    if (isNetworkError(e)) return fb()
    throw e
  }
}

/** 后端源：当 VITE_API_BASE 为绝对地址时解析出 origin，用于拼接 /static 图片 */
function apiOrigin(): string {
  if (/^https?:\/\//.test(API_BASE)) {
    try {
      return new URL(API_BASE).origin
    } catch {
      return ''
    }
  }
  return ''
}

/** 把后端相对路径（/static/...）转成可访问 URL（跨源部署时自动拼上后端源） */
export function resolveAsset(url: string | null | undefined): string {
  if (!url) return ''
  if (/^https?:\/\//.test(url) || url.startsWith('data:') || url.startsWith('blob:')) return url
  const origin = apiOrigin()
  if (origin && url.startsWith('/')) return `${origin}${url}`
  return url
}

/** 把 File 读成 data URL（演示模式上传用） */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

// ================= 认证 =================
export const authApi = {
  login: (userInfo: string, password: string) =>
    call<TokenResult>(
      () =>
        request('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ user_info: userInfo, password }),
        }),
      () => mockApi.login(userInfo, password),
    ),
  register: (username: string, email: string, password: string) =>
    call<User>(
      () =>
        request('/auth/register', {
          method: 'POST',
          body: JSON.stringify({ username, email, password }),
        }),
      () => mockApi.register(),
    ),
  me: () => call<User>(() => request('/auth/me'), () => mockApi.getMe()),
}

// ================= 文章 =================
export const articleApi = {
  list: (page = 1, categoryId?: number, keyword?: string) =>
    call<ArticleListResult>(
      () => {
        const params = new URLSearchParams({ page: String(page) })
        if (categoryId) params.set('category_id', String(categoryId))
        if (keyword) params.set('keyword', keyword)
        return request(`/articles?${params.toString()}`)
      },
      () => mockApi.getArticles(page, categoryId, keyword),
    ),
  get: (id: number) =>
    call<ArticleDetail>(() => request(`/articles/${id}`), () => mockApi.getArticle(id)),
  search: (keyword: string) =>
    call<ArticleListItem[]>(
      () => request(`/articles/search?keyword=${encodeURIComponent(keyword)}`),
      () => mockApi.search(keyword),
    ),
  create: (payload: ArticlePayload) =>
    call<ArticleDetail>(
      () =>
        request('/articles', {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      () => mockApi.getArticle(1),
    ),
  update: (id: number, payload: Partial<ArticlePayload>) =>
    call<ArticleDetail>(
      () =>
        request(`/articles/${id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        }),
      () => mockApi.getArticle(id),
    ),
  remove: (id: number) =>
    call<unknown>(
      () => request(`/articles/${id}`, { method: 'DELETE' }),
      async () => undefined,
    ),
}

// ================= 分类 =================
export const categoryApi = {
  list: () => call<Category[]>(() => request('/categories'), () => mockApi.getCategories()),
  create: (payload: CategoryPayload) =>
    call<Category>(
      () =>
        request('/categories', {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      () => mockApi.createCategory(payload),
    ),
}

// ================= 标签 =================
export const tagApi = {
  list: () => call<Tag[]>(() => request('/tags'), () => mockApi.getTags()),
  create: (tagName: string) =>
    call<Tag>(
      () =>
        request('/tags', {
          method: 'POST',
          body: JSON.stringify({ tag_name: tagName }),
        }),
      () => mockApi.createTag(tagName),
    ),
}

// ================= 页面 =================
export const pageApi = {
  list: () => call<Page[]>(() => request('/pages'), () => mockApi.getPages()),
  get: (id: number) =>
    call<Page>(() => request(`/pages/${id}`), () => mockApi.getPageByName(String(id))),
  getByName: (name: string) =>
    call<Page>(() => request(`/pages/by-name/${encodeURIComponent(name)}`), () => mockApi.getPageByName(name)),
  create: (payload: PagePayload) =>
    call<Page>(
      () =>
        request('/pages', {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      () => mockApi.createPage(payload),
    ),
  update: (id: number, payload: Partial<PagePayload>) =>
    call<Page>(
      () =>
        request(`/pages/${id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        }),
      () => mockApi.updatePage(id, payload),
    ),
  remove: (id: number) =>
    call<unknown>(
      () => request(`/pages/${id}`, { method: 'DELETE' }),
      () => mockApi.deletePage(id),
    ),
}

// ================= 用户管理（仅管理员） =================
export const userApi = {
  list: () =>
    call<User[]>(
      () => request('/users'),
      () => mockApi.getUsers(),
    ),
  setRole: (id: number, role: number) =>
    call<User>(
      () =>
        request(`/users/${id}/role`, {
          method: 'PUT',
          body: JSON.stringify({ role }),
        }),
      () => mockApi.updateUserRole(id, role),
    ),
  remove: (id: number) =>
    call<unknown>(
      () => request(`/users/${id}`, { method: 'DELETE' }),
      () => mockApi.deleteUser(id),
    ),
}

// ================= 站点设置 =================
export const settingApi = {
  all: () => call<SiteSettings>(() => request('/settings'), () => mockApi.getSettings()),
  set: (key: string, value: string) =>
    call<{ key: string; value: string }>(
      () =>
        request(`/settings/${encodeURIComponent(key)}`, {
          method: 'PUT',
          body: JSON.stringify({ value }),
        }),
      () => mockApi.setSetting(key, value),
    ),
  remove: (key: string) =>
    call<unknown>(
      () => request(`/settings/${encodeURIComponent(key)}`, { method: 'DELETE' }),
      () => mockApi.removeSetting(key),
    ),
}

// ================= 上传 =================
export const uploadApi = {
  image: (file: File) =>
    call<UploadResult>(() => {
      const fd = new FormData()
      fd.append('file', file)
      return request('/upload/image', { method: 'POST', body: fd })
    }, async () => {
      // 演示模式：转成 data URL，让图片在预览中真实显示
      return { url: await fileToDataUrl(file), filename: file.name }
    }),
}
