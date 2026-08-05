import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";
import { TypeWriter } from "./Spinner";
import { useSite } from "../lib/site";
import { pageApi, resolveAsset } from "../lib/api";
import { AI_CHAT_MARKER } from "../lib/types";

export function Layout() {
  const { settings, loaded } = useSite();
  const location = useLocation();
  const navigate = useNavigate();
  const [isAIChat, setIsAIChat] = useState(false);

  // 默认落地页：按域名映射（任意域名，不限 Vercel）→ 回退 default_route（国内/海外分站合规）
  useEffect(() => {
    const host = window.location.hostname;
    if (location.pathname !== "/") return;
    let route = "";
    // 1) 域名 → 落地页映射表（精确匹配优先，再子域名后缀匹配）
    //    避免 v2.yogofor.top 被父域 yogofor.top 的后缀匹配抢先导致跳到 '/'
    try {
      const map = JSON.parse(settings.route_map || "{}") as Record<
        string,
        string
      >;
      const keys = Object.keys(map);
      const key =
        keys.find((k) => host === k) ||
        keys.find((k) => host.endsWith("." + k));
      if (key && map[key]) route = map[key];
    } catch (e) {
      console.warn(
        "[route_map] JSON 解析失败，请检查后台设置的 route_map：",
        e,
      );
    }
    // 2) 回退：默认落地页
    if (!route) route = settings.default_route || "";
    if (route && route !== "/") {
      navigate(route, { replace: true });
    }
  }, [settings.route_map, settings.default_route, location.pathname, navigate]);

  // 路由切换时回到顶部
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  // 检测当前 /page/:name 是否为 AI 对话页（ChatGPT 风格全宽布局）
  useEffect(() => {
    let active = true;
    const m = location.pathname.match(/^\/page\/(.+)$/);
    if (!m) {
      setIsAIChat(false);
      return;
    }
    // pathname 是未解码的，需解码才能与页面 name 匹配（useParams 会自动解码）
    let pageName = m[1];
    try {
      pageName = decodeURIComponent(pageName);
    } catch {
      /* keep raw */
    }
    pageApi
      .getByName(pageName)
      .then((p) => {
        if (!active) return;
        setIsAIChat(
          p.type === "html" && (p.content || "").startsWith(AI_CHAT_MARKER),
        );
      })
      .catch(() => {
        if (active) setIsAIChat(false);
      });
    return () => {
      active = false;
    };
  }, [location.pathname]);

  // 动态设置网站图标和标题
  useEffect(() => {
    if (settings.title) {
      document.title = settings.title;
    }
    if (settings.avatar) {
      const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (link) link.href = resolveAsset(settings.avatar);
    }
  }, [settings.title, settings.avatar]);

  // AI 对话页/中心：ChatGPT 风格沉浸式全屏，无全局菜单栏/侧边栏/页脚（避免顶栏重复）
  const isImmersive = isAIChat || location.pathname.startsWith("/ai");
  if (isImmersive) {
    return (
      <div className="flex h-dvh flex-col overflow-hidden">
        <div
          className="bg-fixed-cover"
          style={
            settings.background
              ? { backgroundImage: `url(${resolveAsset(settings.background)})` }
              : undefined
          }
        />
        <div className="bg-blur-overlay" />
        <main className="min-h-0 flex-1">
          <Outlet />
        </main>
      </div>
    );
  }

  // 首页落地页重定向：等待站点设置加载完成再渲染，避免海外站先闪现博客首页再跳转 /ai
  if (location.pathname === "/" && !loaded) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <TypeWriter
          text="Think Different"
          className="text-xl font-medium tracking-[0.2em] text-gray-500 dark:text-gray-400"
        />
        <p className="font-mono text-xs text-gray-300 dark:text-gray-600">
          $ loading ...
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* 背景（原项目：Bing 图 + 白色模糊遮罩） */}
      <div
        className="bg-fixed-cover"
        style={
          settings.background
            ? { backgroundImage: `url(${resolveAsset(settings.background)})` }
            : undefined
        }
      />
      <div className="bg-blur-overlay" />

      <Header />

      <main className="mx-auto my-10 w-full max-w-6xl flex-1 px-4 sm:px-6">
        {location.pathname === "/" || location.pathname.startsWith("/page/") ? (
          <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
            <div className="col-span-1 space-y-6 md:col-span-2">
              <Outlet />
            </div>
            <aside className="col-span-1">
              <div className="sticky top-24 space-y-4">
                <Sidebar />
              </div>
            </aside>
          </div>
        ) : (
          <Outlet />
        )}
      </main>

      {/* 页脚 */}
      <footer className="border-t border-gray-200/70 bg-white/60 py-10 backdrop-blur dark:border-gray-800 dark:bg-gray-950/60">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="flex flex-col items-center justify-between gap-6 sm:flex-row sm:items-start">
            <div className="text-center sm:text-left">
              <p className="text-sm font-semibold text-gray-800">
                {settings.title || "Kimo"}
              </p>
              <p className="mt-1 text-sm text-gray-400">
                {settings.footer
                  ? settings.footer
                  : "© " +
                    (settings.title || "Kimo") +
                    " · Powered by FastAPI + React"}
              </p>
            </div>
            <div className="flex items-center gap-4 text-sm text-gray-400">
              <span>保持热爱</span>
              <span className="h-3 w-px bg-gray-300" />
              <button
                onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                className="flex items-center gap-1 transition hover:text-gray-600"
              >
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M14.77 12.79a.75.75 0 01-1.06-.02L10 8.832 6.29 12.77a.75.75 0 11-1.08-1.04l4.25-4.5a.75.75 0 011.08 0l4.25 4.5a.75.75 0 01-.02 1.06z"
                    clipRule="evenodd"
                  />
                </svg>
                回到顶部
              </button>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
