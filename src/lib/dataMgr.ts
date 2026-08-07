/**
 * 本地数据导出 / 导入（设置页「数据」区块）
 * ------------------------------------------------------------------
 * 覆盖 5 类本机数据：知识库 / 对话历史 / 网页历史 / 自定义 AI 模型 / Live2D 设置。
 * - 纯函数实现 + localStorage，可直接 vitest 单测
 * - 导出：按类别收集 localStorage 键值 → JSON 字符串
 * - 导入：解析 JSON 按类别写回 localStorage
 */
import { downloadText } from "./kb";

export type DataCategory = "kb" | "sessions" | "web" | "aiModel" | "live2d";

export interface DataCategoryDef {
  id: DataCategory;
  label: string;
  desc: string;
  /** 前缀匹配的 localStorage key */
  prefixes: string[];
  /** 精确匹配的 localStorage key */
  exactKeys: string[];
}

export const DATA_CATEGORIES: DataCategoryDef[] = [
  {
    id: "kb",
    label: "知识库",
    desc: "知识条目 / 角色档案",
    prefixes: [
      "kimo_kb_entries",
      "kimo_kb_notes",
      "kimo_kb_sel_",
      "kimo_editor_draft",
    ],
    exactKeys: [],
  },
  {
    id: "sessions",
    label: "对话历史",
    desc: "会话 / 记忆 / 额度",
    prefixes: [
      "kimo_chat_sessions_",
      "kimo_chat_memory_",
      "kimo_chat_consent_",
      "kimo_chat_daily_",
      "kimo_ai_viewtopic_",
      "kimo_ai_agent_state_",
      "kimo_ai_toolcalls_",
      "kimo_ai_fontsize",
      "kimo_ai_net_mode",
      "kimo_ai_tts",
      "kimo_ai_autoknow",
      "kimo_ai_persona_",
      "kimo_ai_custom_model",
    ],
    exactKeys: [],
  },
  {
    id: "web",
    label: "网页历史",
    desc: "浏览 / 搜索缓存",
    prefixes: ["kimo_search_cache_v1"],
    exactKeys: [],
  },
  {
    id: "aiModel",
    label: "自定义 AI 模型",
    desc: "接口 / 密钥 / 模型",
    prefixes: ["kimo_ai_local_"],
    exactKeys: ["kimo_ai_custom_model"],
  },
  {
    id: "live2d",
    label: "Live2D 设置",
    desc: "角色 / 偏好 / 档案",
    prefixes: ["kimo_live2d_"],
    exactKeys: [],
  },
];

export const DATA_EXPORT_TYPE = "kimo-data-export";

/** 收集某类别下的 localStorage 键值（{ key: value }） */
export function collectCategoryData(id: DataCategory): Record<string, string> {
  const def = DATA_CATEGORIES.find((d) => d.id === id);
  if (!def) return {};
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      const hit =
        def.exactKeys.includes(k) || def.prefixes.some((p) => k.startsWith(p));
      if (hit) out[k] = localStorage.getItem(k) || "";
    }
  } catch {
    /* 忽略 */
  }
  return out;
}

export interface DataExportFile {
  app: string;
  type: string;
  version: number;
  exportedAt: string;
  categories: Partial<Record<DataCategory, Record<string, string>>>;
}

/** 导出选中类别为 JSON 字符串 */
export function exportData(ids: DataCategory[]): string {
  const categories: DataExportFile["categories"] = {};
  for (const id of ids) {
    const map = collectCategoryData(id);
    if (Object.keys(map).length) categories[id] = map;
  }
  const file: DataExportFile = {
    app: "kimo",
    type: DATA_EXPORT_TYPE,
    version: 1,
    exportedAt: new Date().toISOString(),
    categories,
  };
  return JSON.stringify(file, null, 2);
}

/** 把导出的 JSON 写回 localStorage；返回 { imported: 成功类别, errors: 失败 key } */
export function importData(json: string): {
  imported: DataCategory[];
  errors: string[];
} {
  let parsed: DataExportFile | null = null;
  try {
    parsed = JSON.parse(json) as DataExportFile;
  } catch {
    return { imported: [], errors: ["文件格式错误：不是有效的 JSON"] };
  }
  if (
    !parsed ||
    parsed.type !== DATA_EXPORT_TYPE ||
    !parsed.categories ||
    typeof parsed.categories !== "object"
  ) {
    return { imported: [], errors: ["文件格式错误：不是 Kimo 数据备份文件"] };
  }
  const imported: DataCategory[] = [];
  const errors: string[] = [];
  for (const def of DATA_CATEGORIES) {
    const map = parsed.categories[def.id];
    if (!map || typeof map !== "object") continue;
    let ok = 0;
    for (const [k, v] of Object.entries(map)) {
      try {
        localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
        ok++;
      } catch {
        errors.push(`${def.label} · ${k}`);
      }
    }
    if (ok > 0) imported.push(def.id);
  }
  return { imported, errors };
}

/** 下载导出文件（下载后提示刷新让数据生效） */
export function downloadData(ids: DataCategory[]): string {
  const json = exportData(ids);
  const date = new Date().toISOString().slice(0, 10);
  downloadText(`kimo-data-${date}.json`, json);
  return json;
}
