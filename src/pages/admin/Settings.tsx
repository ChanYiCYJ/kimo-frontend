import { useEffect, useRef, useState } from "react";
import { pageApi, resolveAsset, settingApi, uploadApi } from "../../lib/api";
import {
  AI_CHAT_MARKER,
  type AIChatConfig,
  type SiteSettings,
} from "../../lib/types";
import { PageSpinner } from "../../components/Spinner";
import { ConfirmDialog } from "../../components/Modal";
import { EmptyState, Switch, btnPrimary } from "../../components/ui";
import { useToast } from "../../lib/toast";
import { useSite } from "../../lib/site";
import { getAIConfig, saveAIConfig, type AIConfig } from "../../lib/ai";

const KNOWN_KEYS: Array<{
  key: string;
  label: string;
  placeholder: string;
  type?: "text" | "textarea";
}> = [
  { key: "title", label: "站点标题", placeholder: "Kimo" },
  { key: "ltitle", label: "副标题", placeholder: "记录技术与生活" },
  { key: "avatar", label: "头像 URL", placeholder: "/favicon.svg" },
  {
    key: "background",
    label: "背景图 URL",
    placeholder: "https://api.1314.cool/bingimg",
  },
  { key: "footer", label: "页脚文字", placeholder: "© Kimo", type: "textarea" },
];

export function Settings() {
  const { settings, loaded, refresh } = useSite();
  const { success, error } = useToast();
  const [form, setForm] = useState<SiteSettings>({});
  const [saving, setSaving] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [routeMapErr, setRouteMapErr] = useState("");
  const avatarInputRef = useRef<HTMLInputElement>(null);

  // 校验域名映射 route_map：必须是「域名 → /路径」的 JSON 对象
  const checkRouteMap = (v: string): boolean => {
    const t = (v || "").trim();
    if (!t) {
      setRouteMapErr("");
      return true;
    }
    try {
      const obj = JSON.parse(t);
      if (typeof obj !== "object" || obj === null || Array.isArray(obj))
        throw new Error("必须是 JSON 对象");
      for (const [k, val] of Object.entries(obj)) {
        if (typeof val !== "string" || !val.startsWith("/"))
          throw new Error(`键 "${k}" 的值必须是 / 开头的路径`);
      }
      setRouteMapErr("");
      return true;
    } catch (e) {
      setRouteMapErr(e instanceof Error ? e.message : "JSON 格式错误");
      return false;
    }
  };
  const [ai, setAi] = useState<AIConfig>(getAIConfig());
  const [aiBots, setAiBots] = useState<
    { id: number; name: string; botName: string }[]
  >([]);
  const [polishBot, setPolishBot] = useState<string>(() => {
    try {
      return localStorage.getItem("kimo_ai_polish_bot") || "";
    } catch {
      return "";
    }
  });

  // 加载 AI 管理中的助手，供「AI 改写」选择
  useEffect(() => {
    pageApi
      .list()
      .then((pages) => {
        const bots = pages
          .filter(
            (p) => p.type === "html" && p.content?.startsWith(AI_CHAT_MARKER),
          )
          .map((p) => {
            try {
              const cfg = JSON.parse(
                (p.content || "").slice(AI_CHAT_MARKER.length),
              ) as AIChatConfig;
              return { id: p.id, name: p.name, botName: cfg.botName || "" };
            } catch {
              return { id: p.id, name: p.name, botName: "" };
            }
          });
        setAiBots(bots);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (loaded) setForm(settings);
  }, [loaded, settings]);

  if (!loaded) return <PageSpinner />;

  const allKeys = new Set([
    ...KNOWN_KEYS.map((k) => k.key),
    ...Object.keys(form),
  ]);

  const save = async () => {
    if (form.route_map && !checkRouteMap(form.route_map)) {
      error("域名映射 route_map 不是合法 JSON，请修正后再保存");
      return;
    }
    setSaving(true);
    try {
      for (const [k, v] of Object.entries(form)) {
        await settingApi.set(k, String(v ?? ""));
      }
      await refresh();
      success("设置已保存");
    } catch (e) {
      error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const onUploadAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await uploadApi.image(file);
      setForm((f) => ({ ...f, avatar: resolveAsset(res.url) }));
      success("头像已上传");
    } catch (err) {
      error(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploading(false);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  };

  const addCustomKey = async () => {
    const key = newKey.trim();
    if (!key) {
      error("请输入键名");
      return;
    }
    if (key in form) {
      error("该键已存在");
      return;
    }
    setForm((f) => ({ ...f, [key]: newValue }));
    setNewKey("");
    setNewValue("");
    success(`已添加 ${key}`);
  };

  const confirmDelete = async () => {
    if (!deletingKey) return;
    try {
      await settingApi.remove(deletingKey);
      setForm((f) => {
        const next = { ...f };
        delete next[deletingKey];
        return next;
      });
      await refresh();
      success("已删除");
    } catch (e) {
      error(e instanceof Error ? e.message : "删除失败");
    } finally {
      setDeletingKey(null);
    }
  };

  const inputCls =
    "w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:placeholder:text-gray-500";

  return (
    <div className="fade-up max-w-3xl space-y-6">
      {/* 基本设置 */}
      <section className="card space-y-4 p-6">
        <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">
          基本设置
        </h2>

        <div className="flex items-center gap-4">
          <span className="grid h-14 w-14 place-content-center overflow-hidden rounded-2xl bg-gray-100 dark:bg-gray-800">
            {form.avatar ? (
              <img
                src={resolveAsset(form.avatar)}
                alt="头像"
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="text-xl font-bold text-gray-900 dark:text-gray-100">
                K
              </span>
            )}
          </span>
          <div>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              onChange={onUploadAvatar}
              className="hidden"
              id="avatar-upload"
            />
            <button
              onClick={() => avatarInputRef.current?.click()}
              disabled={uploading}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {uploading ? "上传中..." : "上传头像"}
            </button>
            <p className="mt-1 text-xs text-gray-400">
              或直接在「头像 URL」输入图片地址
            </p>
          </div>
        </div>

        {KNOWN_KEYS.map((item) => (
          <div key={item.key}>
            <label className="mb-1.5 block text-sm font-medium text-gray-600">
              {item.label}
            </label>
            {item.type === "textarea" ? (
              <textarea
                value={form[item.key] ?? ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, [item.key]: e.target.value }))
                }
                rows={2}
                placeholder={item.placeholder}
                className={`${inputCls} resize-none`}
              />
            ) : (
              <input
                value={form[item.key] ?? ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, [item.key]: e.target.value }))
                }
                placeholder={item.placeholder}
                className={inputCls}
              />
            )}
          </div>
        ))}

        {/* 开放注册开关 */}
        <div className="rounded-xl border border-gray-100 p-4 dark:border-gray-800">
          <Switch
            on={form.allow_register !== "0"}
            onChange={(v) =>
              setForm((f) => ({ ...f, allow_register: v ? "1" : "0" }))
            }
            label="开放注册"
            sub="关闭后，新用户无法在登录页注册（后端也会拒绝注册请求）"
          />
        </div>

        {/* 菜单显示开关 */}
        <div className="space-y-3">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            菜单栏显示
          </p>
          <div className="rounded-xl border border-gray-100 p-4 dark:border-gray-800">
            <Switch
              on={form.show_dashboard !== "0"}
              onChange={(v) =>
                setForm((f) => ({ ...f, show_dashboard: v ? "1" : "0" }))
              }
              label="后台入口"
              sub="在顶部菜单栏显示「管理后台」链接"
            />
          </div>
          <div className="rounded-xl border border-gray-100 p-4 dark:border-gray-800">
            <Switch
              on={form.show_pages !== "0"}
              onChange={(v) =>
                setForm((f) => ({ ...f, show_pages: v ? "1" : "0" }))
              }
              label="自定义页面"
              sub="在顶部菜单栏显示自定义页面链接"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button onClick={save} disabled={saving} className={btnPrimary}>
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
            保存设置
          </button>
        </div>
      </section>

      {/* AI 改写设置：默认使用「AI 管理」中的助手（本地存储，不写入站点键值） */}
      <section className="card space-y-4 p-6">
        <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">
          AI 改写
        </h2>
        <div className="rounded-xl border border-gray-100 p-4 dark:border-gray-800">
          <Switch
            on={ai.enabled}
            onChange={(v) => setAi((a) => ({ ...a, enabled: v }))}
            label="启用 AI 改写"
            sub="在文章编辑器的工具栏中使用「AI 改写」按钮"
          />
        </div>
        <p className="text-xs leading-relaxed text-gray-400">
          默认使用「AI 管理」中创建的 AI 助手；请先到「AI 管理」创建助手，
          并在此选择用于改写文章的那个助手。也可手动指定 OpenAI
          兼容接口作为回退。
        </p>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-600">
            选择用于改写的 AI 助手
          </label>
          <select
            value={polishBot}
            onChange={(e) => {
              setPolishBot(e.target.value);
              try {
                localStorage.setItem("kimo_ai_polish_bot", e.target.value);
              } catch {
                /* 忽略 */
              }
            }}
            className={inputCls}
          >
            <option value="">自动（使用第一个 AI 助手）</option>
            {aiBots.map((b) => (
              <option key={b.id} value={b.id}>
                {b.botName || b.name}
              </option>
            ))}
          </select>
          {aiBots.length === 0 && (
            <p className="mt-1 text-xs text-gray-400">
              尚未配置 AI 助手，请先到「AI 管理」创建。
            </p>
          )}
        </div>

        <div className="rounded-xl border border-dashed border-gray-200 p-3 dark:border-gray-700">
          <p className="mb-2 text-xs font-medium text-gray-400">
            回退配置（仅当未选择助手或助手不可用时生效）
          </p>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-600">
              接口地址（Base URL）
            </label>
            <input
              value={ai.endpoint}
              onChange={(e) =>
                setAi((a) => ({ ...a, endpoint: e.target.value }))
              }
              placeholder="https://api.deepseek.com/v1"
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-600">
              API Key
            </label>
            <input
              type="password"
              value={ai.apiKey}
              onChange={(e) => setAi((a) => ({ ...a, apiKey: e.target.value }))}
              placeholder="sk-..."
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-600">
              模型
            </label>
            <input
              value={ai.model}
              onChange={(e) => setAi((a) => ({ ...a, model: e.target.value }))}
              placeholder="deepseek-chat"
              className={inputCls}
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button
            onClick={() => {
              saveAIConfig(ai);
              success("AI 改写配置已保存");
            }}
            className={btnPrimary}
          >
            保存 AI 改写配置
          </button>
        </div>
      </section>

      {/* 功能开关 */}
      <section className="card space-y-4 p-6">
        <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">
          功能开关
        </h2>
        <div className="rounded-xl border border-gray-100 p-4 dark:border-gray-800">
          <Switch
            on={form.enable_ai_articles === "1"}
            onChange={(v) =>
              setForm((f) => ({
                ...f,
                enable_ai_articles: v ? "1" : "0",
              }))
            }
            label="AI 对话中「写文章」"
            sub="开启后，在 /ai 的「＋」菜单会出现「写文章」，可直接调用后端 API 创建文章（需登录有权限的账号）。"
          />
        </div>
        <div className="rounded-xl border border-gray-100 p-4 dark:border-gray-800">
          <Switch
            on={form.show_ai !== "0"}
            onChange={(v) => setForm((f) => ({ ...f, show_ai: v ? "1" : "0" }))}
            label="主页「AI」菜单"
            sub="关闭后首页导航不再显示「AI」入口（show_ai）。"
          />
        </div>
        <div className="rounded-xl border border-gray-100 p-4 dark:border-gray-800">
          <Switch
            on={form.enable_custom_api !== "0"}
            onChange={(v) =>
              setForm((f) => ({ ...f, enable_custom_api: v ? "1" : "0" }))
            }
            label="访客自定义模型 API"
            sub="关闭后访客不能在侧边栏填写自己的模型 API（enable_custom_api）。"
          />
        </div>
        <div className="rounded-xl border border-gray-100 p-4 dark:border-gray-800">
          <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
            默认落地页（按域名）
          </p>
          <p className="mb-2 mt-0.5 text-xs text-gray-400">
            访客访问首页时自动跳转到该路径（如 /ai）。默认值 default_route
            对所有域名生效；若想按不同域名跳转不同页面（任意域名都行，不局限于
            Vercel），用下方域名映射 route_map。留空则不跳转。
          </p>
          <div>
            <label className="mb-1 block text-xs text-gray-500">
              默认落地页（default_route）
            </label>
            <input
              value={form.default_route || ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, default_route: e.target.value }))
              }
              placeholder="/ai"
              className={inputCls}
            />
          </div>
          <label className="mb-1 mt-3 block text-xs text-gray-500">
            域名 → 落地页映射（route_map，JSON，优先于默认值）
          </label>
          <textarea
            value={form.route_map || ""}
            onChange={(e) => {
              const v = e.target.value;
              setForm((f) => ({ ...f, route_map: v }));
              checkRouteMap(v);
            }}
            rows={4}
            placeholder={
              '{\n  "localhost": "/ai",\n  "yogofor.top": "/",\n  "v2.yogofor.top": "/ai"\n}'
            }
            className={`${inputCls} resize-none font-mono text-xs`}
          />
          {form.route_map?.trim() ? (
            routeMapErr ? (
              <p className="mt-1 text-xs text-red-500">✗ {routeMapErr}</p>
            ) : (
              <p className="mt-1 text-xs text-emerald-600">
                ✓ JSON 格式正确，保存后访问对应域名首页即自动跳转
              </p>
            )
          ) : (
            <p className="mt-1 text-xs text-gray-400">
              键为域名（支持子域名后缀匹配），值为落地路径。任意域名都可配置（如国内
              yogofor.top 落首页、海外 v2.yogofor.top 落 /ai），不局限于
              Vercel。
            </p>
          )}
          <p className="mt-1 text-[11px] text-gray-400">
            提示：键必须是访客实际访问的完整域名（如 www.yogofor.top 会被
            yogofor.top 自动匹配；访问 127.0.0.1 需单独写 "127.0.0.1"
            键）。未列出的域名会回退到上方 default_route。
          </p>
        </div>
      </section>

      {/* Live2D 看板娘 */}
      <section className="card space-y-4 p-6">
        <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">
          Live2D 看板娘
        </h2>
        <div className="rounded-xl border border-gray-100 p-4 dark:border-gray-800">
          <Switch
            on={form.live2d_enable !== "0"}
            onChange={(v) =>
              setForm((f) => ({ ...f, live2d_enable: v ? "1" : "0" }))
            }
            label="启用 Live2D 看板娘"
            sub="开启后 /ai 对话的 Agent 面板会出现「Live2D」tab，角色随对话实时更换情绪。模型来自 bestdori.com（BanG Dream 角色）。"
          />
        </div>
        <div className="rounded-xl border border-gray-100 p-4 dark:border-gray-800">
          <label className="mb-1 block text-xs text-gray-500">
            默认模型名（live2d_model，bestdori 资源名）
          </label>
          <input
            value={form.live2d_model || ""}
            onChange={(e) =>
              setForm((f) => ({ ...f, live2d_model: e.target.value }))
            }
            placeholder="如 001_casual（香澄）/ 011_casual（心）"
            className={inputCls}
          />
          <p className="mt-1 text-[11px] text-gray-400">
            用户可在看板娘「换角色」中切换并保存到本机；留空使用内置默认
            001_casual。
          </p>
        </div>
      </section>

      {/* 全部键值 */}
      <section className="card space-y-4 p-6">
        <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">
          全部设置项
        </h2>

        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="键名，如 github"
            className={`${inputCls} sm:flex-1`}
          />
          <input
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="值"
            className={`${inputCls} sm:flex-1`}
          />
          <button
            onClick={addCustomKey}
            className="shrink-0 rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-gray-300"
          >
            添加
          </button>
        </div>

        {allKeys.size === 0 ? (
          <EmptyState title="暂无设置项" />
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-100 dark:border-gray-800">
            {[...allKeys].map((key, i) => (
              <div
                key={key}
                className={`flex items-center justify-between gap-3 px-4 py-2.5 ${
                  i % 2 === 0
                    ? "bg-white dark:bg-gray-900"
                    : "bg-gray-50/50 dark:bg-gray-800/50"
                }`}
              >
                <div className="min-w-0">
                  <p className="font-mono text-xs font-medium text-gray-700 dark:text-gray-300">
                    {key}
                  </p>
                  <p className="truncate text-sm text-gray-400">
                    {form[key] || "(空)"}
                  </p>
                </div>
                <button
                  onClick={() => setDeletingKey(key)}
                  className="shrink-0 rounded-lg px-2 py-1 text-xs text-red-500 transition hover:bg-red-50 dark:hover:bg-red-500/10"
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <ConfirmDialog
        open={!!deletingKey}
        title="删除设置项"
        message={`确定要删除设置项「${deletingKey}」吗？`}
        onCancel={() => setDeletingKey(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
