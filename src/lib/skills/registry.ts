import type { SkillContext, SkillSection } from "./util";
import { knowledgeSection } from "./knowledgeSkill";
import { personaSection } from "./personaSkill";
import {
  memorySection,
  personaNotesSection,
  summarySection,
} from "./memorySkill";
import { viewIntroSection, viewSection } from "./viewSkill";
import { webSection, modeSection, toolUsageSection } from "./searchSkill";
import { kbSections } from "./kbSkill";
import { live2dSections } from "./live2dSkill";

/**
 * 按需组装 system 提示词：每个功能是一个独立 skill 段（模块化，避免把不相关的
 * 指令/上下文全塞给模型 → 减少混乱 + token）。仅注入「当轮相关」的段：
 * - 上下文段（knowledge/memory/personaNotes/summary/web/viewIntro/view）按内容存在与否注入并各自 clamp；
 * - 核心指令段（persona/mode/toolUsage/kb）按开关注入；Live2D 段仅 l2dEnabled 时注入。
 * 借鉴 Anthropic「just-in-time context」与 LLMLingua 结构化压缩思想：
 * 上下文段=可压缩段（clamp），指令段=保留段（不 clamp）。
 *
 * 段顺序（与旧实现保持一致）：knowledge → persona → memory → personaNotes → summary →
 * web → viewIntro → view → mode → toolUsage → kb(+toolPreface) → live2d(可选)。
 */
export function assembleSystem(ctx: SkillContext): string {
  const sections: SkillSection[] = [
    knowledgeSection(ctx.knowledge || ""),
    personaSection(ctx),
    memorySection(ctx),
    personaNotesSection(ctx),
    summarySection(ctx),
    webSection(ctx),
    viewIntroSection(ctx),
    viewSection(ctx),
    modeSection(ctx),
    toolUsageSection(ctx),
    ...kbSections(),
  ];
  if (ctx.l2dEnabled) sections.push(...live2dSections());
  return sections
    .map((s) => s.text)
    .filter(Boolean)
    .join("");
}

export type { SkillContext, SkillSection };
export { clamp } from "./util";
