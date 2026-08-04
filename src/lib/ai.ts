// ===== AI 服务（OpenAI 兼容 /chat/completions）=====
// 优先复用「AI 管理」中配置的机器人模型；旧配置存于 localStorage 作为回退。

export interface AIConfig {
  /** OpenAI 兼容接口 Base URL，如 https://api.openai.com/v1 */
  endpoint: string
  apiKey: string
  model: string
  enabled: boolean
}

const AI_CONFIG_KEY = 'kimo_ai_config'
/** AICenter 加载时写入的第一个 AI 机器人配置（后台润色等直接复用） */
const BOT_CONFIG_KEY = 'kimo_ai_bot_config'

const DEFAULTS: AIConfig = { endpoint: '', apiKey: '', model: '', enabled: false }

export function getAIConfig(): AIConfig {
  // 优先：AI 管理中心自动写入的机器人配置
  try {
    const botRaw = localStorage.getItem(BOT_CONFIG_KEY)
    if (botRaw) {
      const b = JSON.parse(botRaw) as Partial<AIConfig>
      if (b && b.endpoint && b.apiKey && b.model) {
        return { ...DEFAULTS, enabled: true, ...b }
      }
    }
  } catch { /* 忽略 */ }
  // 回退：旧的站点设置 AI 配置
  try {
    const raw = localStorage.getItem(AI_CONFIG_KEY)
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<AIConfig>) }
  } catch { /* 忽略 */ }
  return { ...DEFAULTS }
}

export function saveAIConfig(cfg: AIConfig): void {
  localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(cfg))
}

/** 确保 AI 已配置，否则抛错并给出引导 */
function assertConfigured(): AIConfig {
  const cfg = getAIConfig()
  if (!cfg.enabled || !cfg.endpoint || !cfg.apiKey || !cfg.model) {
    throw new Error('请先在后台「AI 管理」中配置 AI 助手')
  }
  return cfg
}

/** 基础对话调用（OpenAI 兼容），返回助手文本 */
async function chat(system: string, user: string): Promise<string> {
  const cfg = assertConfigured()
  const base = cfg.endpoint.replace(/\/+$/, '')
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.6,
      stream: false,
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const reason = text.slice(0, 140).replace(/\s+/g, ' ')
    throw new Error(`AI 请求失败 (${res.status})${reason ? `：${reason}` : ''}`)
  }
  const data = await res.json().catch(() => null)
  const text = data?.choices?.[0]?.message?.content
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('AI 返回内容异常，请检查模型与接口配置')
  }
  return text.trim()
}

const POLISH_PROMPT = `你是一位专业的中文博客写作助手。请对下面的 Markdown 文章进行润色：

要求：
- 保留所有 Markdown 语法（标题、列表、引用、代码块、加粗斜体等）与整体结构
- 修正错别字、语法错误与标点符号
- 让表达更流畅、自然、精炼，去掉冗余
- 不改变原文的事实与观点，不新增事实
- 直接输出润色后的完整 Markdown，不要输出任何额外说明或前后缀

===== 文章内容开始 =====
{content}
===== 文章内容结束 =====`

/** 调用 AI 润色文章，返回润色后的 Markdown */
export async function polishMarkdown(content: string): Promise<string> {
  return chat('你是专业的博客写作助手。', POLISH_PROMPT.replace('{content}', content))
}

/** AI 写作辅助 — 根据提示生成/续写/改写 */
export async function aiWrite(prompt: string, context?: string): Promise<string> {
  const system = '你是专业的中文博客写作助手，输出纯 Markdown 格式，不要多余说明。'
  const user = context
    ? `基于以下文章内容，${prompt}：\n\n=====\n${context}\n=====`
    : prompt
  return chat(system, user)
}

/** AI 对话（单轮），供自定义页面调用 */
export async function aiChat(userMessage: string, systemPrompt?: string): Promise<string> {
  return chat(systemPrompt ?? '你是友好的AI助手。', userMessage)
}

/** 站点统计数据（由 DashboardHome 汇总后交给 AI） */
export interface SiteStats {
  siteName: string
  articles: number
  categories: number
  tags: number
  pages: number
  users: number
  recentTitles: string[]
  categoryDistribution: Array<{ name: string; count: number }>
}

const REPORT_PROMPT = `你是站长的数据分析助手。请根据下面的博客站点统计数据，生成一份简洁的「站点运营分析报告」（中文，Markdown 格式）：

要求：
- 用 Markdown 输出，包含：1) 一句话站点概览；2) 数据亮点（2-3 条）；3) 内容建设建议（2-3 条，结合现有文章主题给出可执行建议）；4) 后续优化方向（1-2 条）
- 语气积极、务实，不要编造数据之外的任何数字
- 报告控制在 300 字以内

===== 站点数据 =====
{data}
===== 站点数据结束 =====`

/** 调用 AI 生成站点统计报告 */
export async function generateSiteReport(stats: SiteStats): Promise<string> {
  const payload = JSON.stringify(
    {
      站点名称: stats.siteName,
      文章总数: stats.articles,
      分类数: stats.categories,
      标签数: stats.tags,
      页面数: stats.pages,
      用户数: stats.users,
      最近文章标题: stats.recentTitles,
      分类分布: stats.categoryDistribution,
    },
    null,
    2,
  )
  return chat('你是专业的数据分析助手。', REPORT_PROMPT.replace('{data}', payload))
}
