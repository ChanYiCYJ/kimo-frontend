// ===== 演示数据（后端不可用时自动回退，便于本地预览） =====
// 通过 VITE_USE_MOCK=1 可强制开启演示模式。
import type {
  ArticleDetail,
  ArticleListItem,
  ArticleListResult,
  Category,
  Page,
  SiteSettings,
  Tag,
  User,
} from './types'

const MOCK_ARTICLE_MD = `
# 关于这个博客

折腾了好几个晚上，终于把博客搭起来了。后端用 FastAPI 重写了一遍，前端这次换成了 React。

以后打算在这里记一些技术踩坑、读书笔记和日常随笔。不追求什么流量，能把自己想写的东西写清楚就够了。

> 写作是最好的思考方式。

## 想做的一些事

- [ ] 整理这些年攒下的笔记
- [ ] 把常用的脚本发出来
- [ ] 写写折腾服务器的过程

如果有什么想让我写的话题，欢迎留言告诉我（虽然暂时还没有评论功能）。
`

const MOCK_ARTICLE_MD_2 = `
# 为什么把前端换成 React

原来的博客用的是 Flask 模板，页面一多就有点乱，改个样式要翻好几个 html。前阵子后端用 FastAPI 重写了，前端也顺手换成了 React。

其实刚开始也犹豫过要不要上框架，毕竟静态站也能用。但想想后面要加的功能越来越多，还是早点重构省心。

## 换完之后的感觉

1. 路由切换不用刷新页面了，体验顺滑不少；
2. 组件拆开以后，改样式、加功能都清楚很多；
3. 登录态用 localStorage + Context 管，不用每次发请求都带 cookie 了。

当然也有麻烦的地方，比如新技术的坑要一个个踩。不过总体不后悔。
`

const MOCK_ARTICLE_MD_3 = `
# 写作编辑器选型

写博客最常用的就是编辑器了。之前用的 Vditor 功能很全，不过和 React 配合起来有点别扭，这次换成了 @uiw/react-md-editor。

要求其实不高：

- 能实时预览
- 工具栏别太复杂
- 图片能直接上传

用下来的感觉还行，代码高亮和表格都支持。不过有个小遗憾：默认样式有点花，回头有空再调调。
`

const MOCK_ARTICLE_MD_4 = `
# 记笔记的一些心得

整理笔记这件事，我坚持了好几年，说几点自己的体会。

- **别等完美再记录**，想到什么先写下来，以后再改
- **定期清理**，三个月前的笔记如果不看了，就归档或者删掉
- **写给别人看**，哪怕是给自己，假设读者是三个月后的自己

> 记录的意义不在于保存，而在于想清楚。
`

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

export const mockTags: Tag[] = [
  { id: 1, tag_name: 'React' },
  { id: 2, tag_name: 'TypeScript' },
  { id: 3, tag_name: 'Vite' },
  { id: 4, tag_name: 'FastAPI' },
  { id: 5, tag_name: '随笔' },
  { id: 6, tag_name: '教程' },
]

export const mockCategories: Category[] = [
  { id: 1, name: '技术', slug: 'tech', description: '技术相关文章', created_at: daysAgo(90) },
  { id: 2, name: '随笔', slug: 'notes', description: '日常随笔', created_at: daysAgo(80) },
  { id: 3, name: '生活', slug: 'life', description: '生活记录', created_at: daysAgo(70) },
]

const mockArticles: ArticleDetail[] = [
  {
    id: 1,
    title: '关于这个博客',
    description: '折腾了好几个晚上，终于把博客搭起来了，简单记录一下。',
    cover_image: null,
    created: daysAgo(0),
    category_id: 1,
    category_name: '技术',
    tags: [mockTags[3], mockTags[5]],
    content: MOCK_ARTICLE_MD,
    content_html: '',
  },
  {
    id: 2,
    title: '为什么把前端换成 React',
    description: '聊聊这次重构的动机，和一些踩坑的感想。',
    cover_image: null,
    created: daysAgo(1),
    category_id: 1,
    category_name: '技术',
    tags: [mockTags[0], mockTags[1], mockTags[2]],
    content: MOCK_ARTICLE_MD_2,
    content_html: '',
  },
  {
    id: 3,
    title: '写作编辑器选型',
    description: '从 Vditor 换到 @uiw/react-md-editor 的一点使用感受。',
    cover_image: null,
    created: daysAgo(3),
    category_id: 1,
    category_name: '技术',
    tags: [mockTags[0], mockTags[2]],
    content: MOCK_ARTICLE_MD_3,
    content_html: '',
  },
  {
    id: 4,
    title: '记笔记的一些心得',
    description: '坚持记笔记几年，说说我自己的几点体会。',
    cover_image: null,
    created: daysAgo(6),
    category_id: 2,
    category_name: '随笔',
    tags: [mockTags[4]],
    content: MOCK_ARTICLE_MD_4,
    content_html: '',
  },
]

export const mockPages: Page[] = [
  {
    id: 1,
    name: '关于',
    type: 'markdown',
    status: 0,
    content:
      '<h1>关于</h1><p>这里是本站的「关于」页面。博客是拿 React + FastAPI 搭的，前端沿用 Kimo 的风格重写了一遍。</p><blockquote><p>记录技术、生活与思考。</p></blockquote>',
  },
  {
    id: 2,
    name: '友链',
    type: 'list',
    status: 0,
    content: JSON.stringify([
      { title: 'GitHub', description: 'https://github.com' },
      { title: 'Vite', description: 'https://vitejs.dev' },
    ]),
  },
  { id: 3, name: 'GitHub', type: 'link', status: 0, content: 'https://github.com' },
]

export const mockSettings: SiteSettings = {
  title: 'Kimo',
  ltitle: '记录技术、生活与思考',
  avatar: '/favicon.svg',
  background: 'https://api.1314.cool/bingimg',
  footer: '© Kimo · Powered by FastAPI + React',
}

export const mockAdmin: User = {
  id: 1,
  email: 'admin@kimo.dev',
  user_name: 'admin',
  role: 0,
}

const wait = (ms = 350) => new Promise((r) => setTimeout(r, ms))

function toListItem(a: ArticleDetail): ArticleListItem {
  const { content: _c, content_html: _h, ...rest } = a
  return rest
}

export const mockApi = {
  async getArticles(page = 1, categoryId?: number, keyword?: string): Promise<ArticleListResult> {
    await wait()
    let list = [...mockArticles]
    if (categoryId) list = list.filter((a) => a.category_id === categoryId)
    if (keyword) list = list.filter((a) => a.title.toLowerCase().includes(keyword.toLowerCase()))
    const pageSize = 5
    const total = list.length
    const total_page = Math.max(1, Math.ceil(total / pageSize))
    const items = list.slice((page - 1) * pageSize, page * pageSize).map(toListItem)
    return { items, total, page, page_size: pageSize, total_page }
  },
  async getArticle(id: number): Promise<ArticleDetail> {
    await wait()
    const a = mockArticles.find((x) => x.id === id)
    if (!a) throw new Error('文章不存在')
    return a
  },
  async search(keyword: string): Promise<ArticleListItem[]> {
    await wait()
    return mockArticles
      .filter((a) => a.title.toLowerCase().includes(keyword.toLowerCase()))
      .map(toListItem)
  },
  async getCategories(): Promise<Category[]> {
    await wait(200)
    return mockCategories
  },
  async getTags(): Promise<Tag[]> {
    await wait(200)
    return mockTags
  },
  async getPages(): Promise<Page[]> {
    await wait(200)
    return mockPages
  },
  async getPageByName(name: string): Promise<Page> {
    await wait(200)
    const p = mockPages.find((x) => x.name === name)
    if (!p) throw new Error('页面不存在')
    return p
  },
  async getSettings(): Promise<SiteSettings> {
    await wait(200)
    return { ...mockSettings }
  },
  async login(_userInfo: string, _password: string): Promise<{ access_token: string; token_type: string; user: User }> {
    await wait(500)
    return { access_token: 'mock-token', token_type: 'bearer', user: mockAdmin }
  },
  async register(): Promise<User> {
    await wait(500)
    return { ...mockAdmin, id: 99, user_name: 'user' }
  },
  async getMe(): Promise<User> {
    await wait(200)
    return mockAdmin
  },
}
