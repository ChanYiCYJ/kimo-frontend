// ===== AI 润色服务（OpenAI 兼容 /chat/completions）=====
// 配置存于 localStorage（在「站点设置 → AI 润色」中维护），避免把 Key 写进代码/仓库。

export interface AIConfig {
  /** OpenAI 兼容接口 Base URL，如 https://api.openai.com/v1 */
  endpoint: string
  apiKey: string
  model: string
  enabled: boolean
}

const AI_CONFIG_KEY = 'kimo_ai_config'

const DEFAULTS: AIConfig = { endpoint: '', apiKey: '', model: '', enabled: false }

export function getAIConfig(): AIConfig {
  try {
    const raw = localStorage.getItem(AI_CONFIG_KEY)
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<AIConfig>) }
  } catch {
    /* 忽略 */
  }
  return { ...DEFAULTS }
}

export function saveAIConfig(cfg: AIConfig): void {
  localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(cfg))
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
  const cfg = getAIConfig()
  if (!cfg.enabled || !cfg.endpoint || !cfg.apiKey || !cfg.model) {
    throw new Error('请先在「站点设置 → AI 润色」中配置接口地址、Key 与模型')
  }
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
        { role: 'system', content: '你是专业的博客写作助手。' },
        { role: 'user', content: POLISH_PROMPT.replace('{content}', content) },
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
