import { clamp, type SkillContext, type SkillSection } from "./util";
import { todayStr } from "../searchApi";

/** 网络搜索结果（可压缩段 6000） */
export function webSection(ctx: SkillContext): SkillSection {
  const cap = clamp(ctx.web || "", 6000);
  return {
    id: "web",
    text: cap
      ? `\n\n今天是 ${todayStr()}。以下是来自网络的最新搜索结果，请基于它们回答，引用具体数据/日期并注明来源（若信息可能已过时请如实说明）：\n${cap}`
      : "",
  };
}

/**
 * 模式说明段（核心指令段，保留）：Fast / Auto / 联网搜索（browseMode）三选一。
 * 由 send() 保证三者互斥，这里按优先级只产出一种，避免同屏矛盾。
 */
export function modeSection(ctx: SkillContext): SkillSection {
  let text = "";
  if (ctx.fastMode) {
    text =
      "\n\n【快速模式 Fast】当前为纯本地快速模式：请直接基于你自己的知识、对话记忆与本地知识库快速、简洁地回答（能答就答，简洁优先）。**不要联网搜索、不要生成文章**：不要输出 [SEARCH:] / [BROWSE:] / [VIEW:] 等任何网络工具指令；若问题需要实时/最新信息或你完全不了解，请如实说明当前无法联网查询，并建议用户切换到 Auto（适当联网）或 Deep（生成完整文章）模式。";
  } else if (ctx.autoMode) {
    text =
      "\n\n【智能模式 Auto】当前为智能模式：默认直接基于你的知识快速、简洁地回答（不需要联网就绝不联网）。但如果你对用户的问题**没有准确、可靠或最新的数据**，必须主动升级联网搜索，规则：\n① 需要实时/最新资讯，或只需简单事实核查 → 先输出 1-2 句中文说明，然后附上 [SEARCH:关键词]（**关键词必须多语言混合**：保留用户原语言 + 空格 + 英文翻译，如动漫/新番类附日文——「2026年夏アニメ 一覧 anime summer 2026 lineup」），我会联网搜索并让你基于结果准确回答；\n② 完整综合文章（长篇介绍/盘点/攻略/评测等）的生成仅限 Deep 模式：当前 Auto 模式**不要生成完整文章、不要输出 [VIEW:]**；若用户明确要求生成完整文章，请说明需要切换到 Deep 模式。\n判断原则：能直接回答就回答（快）；拿不准/信息过时/不熟悉才升级。不要为了联网而联网。";
  } else if (ctx.browseMode) {
    text =
      "\n\n【联网搜索模式】当前已开启「搜索」：搜索与生成综合文章由浏览面板负责，你只需简短引导。规则：当用户提问需要查询外部/最新/不熟悉的信息时，只允许输出 1-2 句简短的中文说明（不超过 50 字），然后必须附上 [SEARCH:关键词]（**多语言混合关键词**：保留用户原语言 + 英文翻译，动漫/新番类附日文，如「2026年夏アニメ 一覧 anime summer 2026 lineup」；涉近期事件可带日期，如 2026年8月）；严禁自行展开成长篇回答，详细内容一律交给搜索生成。**这 1-2 句说明请严格保持你一贯的语气与性格（按你的系统人设来回应，自然、有辨识度），不要用生硬的套话。**若问题不需要联网（寒暄、写代码、简单常识等），正常按你的风格简短回答即可。";
  }
  return { id: "mode", text };
}

/**
 * 工具使用说明（核心指令段，保留；webTools 控制 SEARCH/BROWSE，browseMode 控制 [VIEW:]）。
 * 与模式段分工：模式段定义「要不要联网」，本段定义「怎么用工具」，避免重复。
 */
export function toolUsageSection(ctx: SkillContext): SkillSection {
  const tools = ctx.webTools
    ? `今天是 ${todayStr()}。当用户询问实时动态、最新资讯、或不熟悉的时效性信息时，请主动联网搜索并回复 [SEARCH:关键词]（**关键词必须多语言混合**：保留用户原语言 + 空格 + 英文翻译；涉及日本动漫/新番类再附日文，如「2026年夏アニメ 一覧 anime summer 2026 lineup」，多语源命中准确率更高；不要构造或浏览搜索引擎 URL；涉近期事件的关键词可带日期，如 2026年8月）；当用户明确给出某个网页链接并要求获取其内容时，回复 [BROWSE:url]；`
    : "";
  const view = ctx.browseMode
    ? "当需要更新当前浏览文章（View 面板中的文章）时，用 [VIEW:修改后的完整文章] 括起。"
    : "";
  return {
    id: "toolUsage",
    text: `\n\n工具使用说明：${tools}当需要帮你写作文档或编辑内容时，用 [EDIT:内容] 括起完整内容（必须用 ] 闭合，且编辑内容之后不要再追加其他文字）；${view}`,
  };
}
