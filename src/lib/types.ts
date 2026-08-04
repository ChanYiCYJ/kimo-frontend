// ===== 与 kimo-fastapi 后端 schema 对应的类型定义 =====

/** 统一响应结构 { code, message, data } */
export interface ApiResponse<T> {
  code: number
  message: string
  data: T | null
}

// ---- 认证 ----
export interface User {
  id: number
  email: string
  user_name: string | null
  /** 0=管理员, 1=普通用户 */
  role: number
  created_at?: string | null
}

export interface TokenResult {
  access_token: string
  token_type: string
  user: User
}

// ---- 文章 ----
export interface Tag {
  id: number
  tag_name: string
}

export interface ArticleListItem {
  id: number
  title: string
  description: string | null
  cover_image: string | null
  created: string
  category_id: number | null
  category_name: string | null
  tags: Tag[]
}

export interface ArticleDetail extends ArticleListItem {
  content: string
  content_html: string
}

export interface ArticleListResult {
  items: ArticleListItem[]
  total: number
  page: number
  page_size: number
  total_page: number
}

export interface ArticlePayload {
  title: string
  content: string
  description?: string | null
  cover_image?: string | null
  category_id?: number | null
  tags?: string[]
}

// ---- 分类 ----
export interface Category {
  id: number
  name: string
  slug: string
  description: string | null
  created_at: string
}

export interface CategoryPayload {
  name: string
  description?: string | null
  slug?: string | null
}

// ---- 页面 ----
export type PageType = 'markdown' | 'html' | 'list' | 'link' | 'ai-chat'

export interface Page {
  id: number
  name: string
  content: string | null
  type: PageType
  status: number
}

export interface PagePayload {
  name: string
  content?: string | null
  type?: PageType
  status?: number
}

// ---- 站点设置（键值对）----
export type SiteSettings = Record<string, string>

// ---- 上传 ----
export interface UploadResult {
  url: string
  filename: string
}
