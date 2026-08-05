/**
 * AI 工具指令文本过滤
 * 从 AI 回复的显示文本中隐藏工具指令（[SEARCH:] / [BROWSE:] / [EDIT:] / [KB-*] 等），
 * 它们由对话中的 toolCalls 小卡片承载展示，避免在消息里露出原始标记。
 */
export function stripToolCmds(content: string): string {
  return (
    content
      // 1) 成对块：KB-SAVE / KB-EDIT
      .replace(/\[KB-SAVE:\s*[^\]]*\]\s*[\s\S]*?\[\/KB-SAVE\]/gi, "")
      .replace(/\[KB-EDIT:\s*[^\]]*\]\s*[\s\S]*?\[\/KB-EDIT\]/gi, "")
      // 2) 闭合单行指令（[SEARCH: x] 等）
      .replace(/\[(?:SEARCH|BROWSE|KB|OPEN_KB|知识库|EDIT):\s*[^\]]*\]/gi, "")
      // 3) 未闭合指令（到行尾，兼容 AI 漏写 ]）
      .replace(/\[(?:SEARCH|BROWSE|KB|OPEN_KB|知识库|EDIT):[^\n]*$/gi, "")
      // 4) 清理孤立标记（残留 [SEARCH] / [/SEARCH] 等）
      .replace(/\[\/?(?:SEARCH|BROWSE|KB|OPEN_KB|知识库|EDIT)\]/gi, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}
