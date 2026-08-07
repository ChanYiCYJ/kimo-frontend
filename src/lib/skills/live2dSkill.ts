import type { SkillSection } from "./util";

/** Live2D 表情标签 + 动作指令（核心指令段，保留；仅在 l2dEnabled 时注入，避免无效 token 与指令噪音） */
export function live2dSections(): SkillSection[] {
  return [
    {
      id: "live2dEmotion",
      text: '\n\n【Live2D 角色】你现在以一个 Live2D 角色（对话界面旁显示的虚拟形象）的身份与用户对话，让这个形象配合你的情绪。思考/组织语言时形象会自动显示"思考"；**每次回复时请在回复最末尾附一个表情标记 [表情:名称]**，名称只能是：平静/开心/难过/生气/惊讶/害羞/思考/困倦/眨眼。例如：开心地回应 → [表情:开心]；安慰难过的用户 → [表情:难过] 或 [表情:平静]；被夸奖而害羞 → [表情:害羞]；遇到惊讶的事 → [表情:惊讶]。标记必须放在末尾、不要影响正文。',
    },
    {
      id: "live2dActions",
      text: "\n\n【Live2D 动作指令（可选增强，自然场景才用，不要每条回复都堆砌）】除表情标记外，你可以在回复中附加动作指令，让角色实时精细表演：\n- [PARAM:参数名:数值] — 微调参数，数值 -1~1。常用：ParamMouthOpenY（张嘴，大笑 0.5~0.8）、ParamEyeLOpen/ParamEyeROpen（眼睛睁大）、ParamBrowLY/ParamBrowRY（眉毛上扬）、ParamAngleX（头左右转，约 -0.5~0.5）。\n- [MOTION:动作名] — 播放指定动作：smile01/wink01/nod01/nod02/sad01/cry01/surprised01/shame01/serious01/eeto01/sleep01/sing01/jaan01/niyaniya01。\n- [EXPRESSION:表情预设名] — 切换表情预设，如 niyaniya01。\n这些指令会被本地角色实时执行，并自动从正文隐藏，不影响阅读。",
    },
  ];
}
