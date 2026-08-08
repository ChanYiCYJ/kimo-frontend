import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { pageApi } from "../../lib/api";
import type {
  Page,
  PageDisplayType,
  PageType,
  AIChatConfig,
} from "../../lib/types";
import { AI_CHAT_MARKER, decodeKey } from "../../lib/types";
import { MdEditor } from "../../components/MdEditor";
import { PageSpinner } from "../../components/Spinner";
import { BotEditorModal } from "../../components/BotEditorModal";
import { btnPrimary } from "../../components/ui";
import { useToast } from "../../lib/toast";
import type { BotItem } from "../../components/AIChat";

const TYPE_OPTIONS: Array<{
  value: PageDisplayType;
  label: string;
  desc: string;
}> = [
  {
    value: "markdown",
    label: "Markdown",
    desc: "富文本页面，适合「关于」「归档」",
  },
  { value: "html", label: "HTML", desc: "自定义 HTML / JS 内容" },
  { value: "list", label: "List", desc: "链接列表，如「友链」" },
  { value: "ai-chat", label: "AI 对话", desc: "内嵌 AI 聊天组件，无需内容" },
  { value: "link", label: "Link", desc: "跳转到外部链接" },
];

/** 把 AI 页面解析为 BotItem（供 BotEditorModal 编辑复用，密钥还原） */
function parseBotFromPage(p: Page): BotItem | null {
  if (p.type !== "html" || !p.content?.startsWith(AI_CHAT_MARKER)) return null;
  try {
    const raw = JSON.parse(
      p.content.slice(AI_CHAT_MARKER.length),
    ) as AIChatConfig;
    return {
      id: p.id,
      name: p.name,
      config: { ...raw, apiKey: decodeKey(raw.apiKey) },
      page: p,
    };
  } catch {
    return null;
  }
}

export function PageEditor() {
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  const navigate = useNavigate();
  const { success, error } = useToast();

  const [name, setName] = useState("");
  const [type, setType] = useState<PageDisplayType>("markdown");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [hidden, setHidden] = useState(false);

  // AI 对话配置（复用统一的 BotEditorModal）
  const [botModalOpen, setBotModalOpen] = useState(false);
  const [editingBot, setEditingBot] = useState<BotItem | null>(null);
  const [botSummary, setBotSummary] = useState<{
    name: string;
    model: string;
    endpoint: string;
  } | null>(null);

  useEffect(() => {
    if (isEdit) {
      pageApi
        .get(Number(id))
        .then((p) => {
          setName(p.name);
          setHidden(p.status !== 0);
          if (p.type === "html" && p.content?.startsWith(AI_CHAT_MARKER)) {
            setType("ai-chat");
            setContent("");
            const b = parseBotFromPage(p);
            if (b) {
              setBotSummary({
                name: b.config.botName || b.name,
                model: b.config.model || "",
                endpoint: b.config.endpoint || "",
              });
            }
          } else {
            setType(p.type as PageDisplayType);
            setContent(p.content ?? "");
          }
        })
        .catch((e: Error) => error(e.message || "加载失败"))
        .finally(() => setLoading(false));
    }
  }, [isEdit, id, error]);

  if (loading) return <PageSpinner />;

  const inputCls =
    "w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:placeholder:text-gray-500";

  const renderContentEditor = () => {
    switch (type) {
      case "markdown":
        return <MdEditor value={content} onChange={setContent} height={420} />;
      case "html":
        return (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={10}
            placeholder="<p>HTML 内容...</p>"
            className={`${inputCls} font-mono`}
          />
        );
      case "list":
        return (
          <div className="space-y-2">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={8}
              placeholder='JSON 数组，例如：[{"title":"GitHub","description":"https://github.com"}]'
              className={`${inputCls} font-mono`}
            />
            <p className="text-xs text-gray-400">
              使用 JSON 数组格式，每项包含{" "}
              <code className="rounded bg-gray-100 px-1 dark:bg-gray-800">
                title
              </code>{" "}
              与{" "}
              <code className="rounded bg-gray-100 px-1 dark:bg-gray-800">
                description
              </code>
              （若 description 为链接会自动渲染「前往」按钮）
            </p>
          </div>
        );
      case "link":
        return (
          <input
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="https://example.com"
            className={inputCls}
          />
        );
    }
  };

  // 打开统一的 AI 助手编辑器（新建时预填页面名；编辑时构造 BotItem）
  const openBotModal = () => {
    if (isEdit) {
      pageApi
        .get(Number(id))
        .then((p) => {
          setEditingBot(
            parseBotFromPage({ ...p, name: name.trim() || p.name }),
          );
          setBotModalOpen(true);
        })
        .catch(() => {
          setEditingBot(null);
          setBotModalOpen(true);
        });
    } else {
      setEditingBot(null);
      setBotModalOpen(true);
    }
  };

  const onBotSaved = async () => {
    setBotModalOpen(false);
    if (isEdit) {
      try {
        const p = await pageApi.get(Number(id));
        const b = parseBotFromPage(p);
        if (b) {
          setBotSummary({
            name: b.config.botName || b.name,
            model: b.config.model || "",
            endpoint: b.config.endpoint || "",
          });
        }
        success("AI 助手已更新");
      } catch {
        /* 忽略 */
      }
    } else {
      success("AI 助手已创建");
      navigate("/dashboard/pages");
    }
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      error("请输入页面名称");
      return;
    }
    if (type === "ai-chat") {
      openBotModal();
      return;
    }
    if (type !== "list" && !content.trim()) {
      error("请输入页面内容");
      return;
    }
    if (type === "list") {
      try {
        JSON.parse(content || "[]");
      } catch {
        error("List 内容必须是合法的 JSON");
        return;
      }
    }
    setSaving(true);
    const payload = {
      name: name.trim(),
      type: type as PageType,
      content: content || null,
      status: hidden ? 1 : 0,
    };
    try {
      if (isEdit) {
        await pageApi.update(Number(id), payload);
        success("页面已更新");
      } else {
        await pageApi.create(payload);
        success("页面已创建");
      }
      navigate("/dashboard/pages");
    } catch (e) {
      error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={() => navigate("/dashboard/pages")}
          className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          ← 返回
        </button>
        <button
          onClick={handleSubmit}
          disabled={saving}
          className="flex items-center gap-2 rounded-xl bg-gray-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-gray-700 active:scale-[0.98] disabled:opacity-60 dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-gray-300"
        >
          {saving && (
            <svg
              className="h-4 w-4 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          )}
          {type === "ai-chat"
            ? "配置 AI 助手"
            : isEdit
              ? "保存修改"
              : "创建页面"}
        </button>
      </div>

      {/* 名称 + 隐藏开关 */}
      <div className="flex items-center gap-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="页面名称，如：about / 关于"
          className="flex-1 rounded-2xl border border-gray-200 bg-white px-5 py-3.5 text-xl font-semibold text-gray-900 outline-none transition placeholder:text-gray-300 focus:border-gray-300 focus:ring-2 focus:ring-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-600"
        />
        <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-500 transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800">
          <input
            type="checkbox"
            checked={hidden}
            onChange={(e) => setHidden(e.target.checked)}
            className="h-4 w-4 accent-gray-900"
          />
          隐藏
        </label>
      </div>

      {/* 类型选择 */}
      <div>
        <label className="mb-2 block text-sm font-medium text-gray-600 dark:text-gray-300">
          页面类型
        </label>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setType(opt.value)}
              className={`rounded-2xl border p-3.5 text-left transition ${
                type === opt.value
                  ? "border-gray-400 bg-gray-100 ring-2 ring-gray-100 dark:border-gray-500 dark:bg-gray-800 dark:ring-gray-700"
                  : "border-gray-200 bg-white hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-600"
              }`}
            >
              <p
                className={`text-sm font-semibold ${type === opt.value ? "text-gray-900 dark:text-gray-100" : "text-gray-700 dark:text-gray-300"}`}
              >
                {opt.label}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-gray-400">
                {opt.desc}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* 内容 / AI配置 */}
      {type === "ai-chat" ? (
        <div className="card space-y-4 p-5">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
            AI 对话配置
          </h3>
          <p className="text-xs leading-relaxed text-gray-400">
            AI 对话页面使用统一的「AI 助手编辑器」配置（名称 / 模型 / 接口 /
            密钥 / 提示词 / 上限 / 冷却等），与「AI
            管理」中的助手完全一致，字段与功能同步维护。
          </p>

          <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50/50 p-4 dark:border-gray-800 dark:bg-gray-800/50">
            {botSummary ? (
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-800 dark:text-gray-100">
                  {botSummary.name}
                </p>
                <p className="truncate text-xs text-gray-400">
                  {botSummary.model} · {botSummary.endpoint}
                </p>
              </div>
            ) : (
              <p className="text-sm text-gray-400">
                尚未配置 AI 助手，点击右侧按钮创建。
              </p>
            )}
            <button onClick={openBotModal} className={btnPrimary}>
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path strokeLinecap="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              {isEdit ? "编辑配置" : "创建配置"}
            </button>
          </div>
        </div>
      ) : (
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-600">
            内容
          </label>
          {renderContentEditor()}
        </div>
      )}

      {/* 统一的 AI 助手编辑器 */}
      <BotEditorModal
        open={botModalOpen}
        onClose={() => setBotModalOpen(false)}
        bot={editingBot}
        defaultName={name.trim()}
        onSaved={onBotSaved}
      />
    </div>
  );
}
