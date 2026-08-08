import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  articleApi,
  categoryApi,
  pageApi,
  statsApi,
  tagApi,
  userApi,
} from "../../lib/api";
import type { ArticleListItem, StatsOverview } from "../../lib/types";
import { Skeleton, btnPrimary } from "../../components/ui";
import { useToast } from "../../lib/toast";
import { useSite } from "../../lib/site";
import { generateSiteReport, getAIConfig } from "../../lib/ai";

/** 近 14 天发文趋势（轻量自绘 SVG 柱状图，零依赖） */
function TrendChart({
  trend,
}: {
  trend: Array<{ date: string; count: number }>;
}) {
  const max = Math.max(1, ...trend.map((t) => t.count));
  const W = 600;
  const H = 180;
  const pad = 24;
  const bw = (W - pad * 2) / Math.max(1, trend.length);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label="近 14 天发文趋势"
    >
      {trend.map((t, i) => {
        const h = (t.count / max) * (H - pad * 2 - 16);
        const x = pad + i * bw;
        const y = H - pad - h;
        return (
          <g key={t.date}>
            <rect
              x={x + bw * 0.22}
              y={y}
              width={bw * 0.56}
              height={Math.max(h, t.count > 0 ? 2 : 0)}
              rx={3}
              className="fill-gray-900 dark:fill-gray-300"
            />
            {t.count > 0 && (
              <text
                x={x + bw / 2}
                y={y - 4}
                textAnchor="middle"
                className="fill-gray-400 text-[10px]"
              >
                {t.count}
              </text>
            )}
            {i % 3 === 0 && (
              <text
                x={x + bw / 2}
                y={H - 6}
                textAnchor="middle"
                className="fill-gray-400 text-[9px]"
              >
                {t.date.slice(5)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function DashboardHome() {
  const { settings } = useSite();
  const { success, error } = useToast();
  const [stats, setStats] = useState<Record<string, number>>({
    articles: 0,
    categories: 0,
    tags: 0,
    pages: 0,
    users: 0,
  });
  const [recent, setRecent] = useState<ArticleListItem[]>([]);
  const [loading, setLoading] = useState(true);
  // 站点统计（趋势/分类分布）
  const [overview, setOverview] = useState<StatsOverview | null>(null);
  // AI 站点统计
  const [report, setReport] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.allSettled([
      articleApi.list(1),
      categoryApi.list(),
      tagApi.list(),
      pageApi.list(),
      userApi.list(),
    ]).then((res) => {
      if (!active) return;
      const art = res[0].status === "fulfilled" ? res[0].value : null;
      if (art) {
        setStats((s) => ({ ...s, articles: art.total }));
        setRecent(art.items);
      }
      const cat = res[1].status === "fulfilled" ? res[1].value.length : 0;
      const tag = res[2].status === "fulfilled" ? res[2].value.length : 0;
      const page = res[3].status === "fulfilled" ? res[3].value.length : 0;
      const usr = res[4].status === "fulfilled" ? res[4].value.length : 0;
      setStats((s) => ({
        ...s,
        categories: cat,
        tags: tag,
        pages: page,
        users: usr,
      }));
      setLoading(false);
    });
    statsApi
      .overview()
      .then((o) => {
        if (active) setOverview(o);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const runAiReport = async () => {
    if (!getAIConfig().enabled) {
      error("请先在「站点设置 → AI 改写」中配置 AI 接口");
      return;
    }
    setAiLoading(true);
    setReport("");
    try {
      // 分类分布：按最近一页文章统计
      const dist = new Map<string, number>();
      recent.forEach((a) => {
        const k = a.category_name || "未分类";
        dist.set(k, (dist.get(k) ?? 0) + 1);
      });
      const text = await generateSiteReport({
        siteName: settings.title || "Kimo",
        articles: stats.articles,
        categories: stats.categories,
        tags: stats.tags,
        pages: stats.pages,
        users: stats.users,
        recentTitles: recent.map((a) => a.title),
        categoryDistribution: [...dist.entries()].map(([name, count]) => ({
          name,
          count,
        })),
      });
      setReport(text);
    } catch (e) {
      error(e instanceof Error ? e.message : "AI 报告生成失败");
    } finally {
      setAiLoading(false);
    }
  };

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      success("报告已复制");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      error("复制失败");
    }
  };

  const links = [
    {
      to: "/dashboard/articles/new",
      title: "创建文章",
      desc: "写一篇新的文章",
    },
    {
      to: "/dashboard/articles",
      title: "管理文章",
      desc: "编辑、删除已有文章",
    },
    {
      to: "/dashboard/pages/new",
      title: "创建页面",
      desc: "关于、友链等自定义页面",
    },
    { to: "/dashboard/users", title: "用户管理", desc: "管理注册用户与权限" },
    {
      to: "/dashboard/settings",
      title: "站点设置",
      desc: "标题、副标题、AI 润色等",
    },
  ];

  return (
    <div className="space-y-8">
      {/* 统计 */}
      {loading ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
          <Link
            to="/dashboard/articles"
            className="card block p-5 transition hover:-translate-y-1 hover:shadow-sm"
          >
            <p className="text-3xl font-semibold text-gray-900 dark:text-gray-100">
              {stats.articles}
            </p>
            <p className="mt-1 flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400">
              文章 <span className="text-gray-300 dark:text-gray-600">→</span>
            </p>
          </Link>
          <Link
            to="/dashboard/categories"
            className="card block p-5 transition hover:-translate-y-1 hover:shadow-sm"
          >
            <p className="text-3xl font-semibold text-gray-900 dark:text-gray-100">
              {stats.categories}
            </p>
            <p className="mt-1 flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400">
              分类 <span className="text-gray-300 dark:text-gray-600">→</span>
            </p>
          </Link>
          <Link
            to="/dashboard/categories"
            className="card block p-5 transition hover:-translate-y-1 hover:shadow-sm"
          >
            <p className="text-3xl font-semibold text-gray-900 dark:text-gray-100">
              {stats.tags}
            </p>
            <p className="mt-1 flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400">
              标签 <span className="text-gray-300 dark:text-gray-600">→</span>
            </p>
          </Link>
          <Link
            to="/dashboard/pages"
            className="card block p-5 transition hover:-translate-y-1 hover:shadow-sm"
          >
            <p className="text-3xl font-semibold text-gray-900 dark:text-gray-100">
              {stats.pages}
            </p>
            <p className="mt-1 flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400">
              页面 <span className="text-gray-300 dark:text-gray-600">→</span>
            </p>
          </Link>
          <Link
            to="/dashboard/users"
            className="card block p-5 transition hover:-translate-y-1 hover:shadow-sm"
          >
            <p className="text-3xl font-semibold text-gray-900 dark:text-gray-100">
              {stats.users}
            </p>
            <p className="mt-1 flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400">
              用户 <span className="text-gray-300 dark:text-gray-600">→</span>
            </p>
          </Link>
        </div>
      )}

      {/* 数据统计：发文趋势 + 分类分布 */}
      {overview && (
        <section className="card p-6">
          <h2 className="flex items-center gap-2 text-base font-semibold text-gray-800 dark:text-gray-100">
            <svg
              className="h-4 w-4 text-gray-500"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
              />
            </svg>
            数据统计
          </h2>
          <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_1fr]">
            <div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-300">
                近 14 天发文趋势
              </p>
              <div className="mt-2 rounded-xl border border-gray-100 bg-gray-50/50 p-3 dark:border-gray-800 dark:bg-gray-800/50">
                {overview.trend.some((t) => t.count > 0) ? (
                  <TrendChart trend={overview.trend} />
                ) : (
                  <p className="py-10 text-center text-sm text-gray-400">
                    近 14 天暂无发文
                  </p>
                )}
              </div>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-300">
                分类分布
              </p>
              {overview.category_distribution.length > 0 ? (
                <ul className="mt-2 space-y-1.5">
                  {overview.category_distribution.map((d) => {
                    const pct = overview.articles
                      ? Math.round((d.count / overview.articles) * 100)
                      : 0;
                    return (
                      <li key={d.name} className="flex items-center gap-2">
                        <span className="w-20 shrink-0 truncate text-sm text-gray-600 dark:text-gray-300">
                          {d.name}
                        </span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                          <div
                            className="h-full rounded-full bg-gray-900 dark:bg-gray-300"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="w-8 shrink-0 text-right text-xs text-gray-400">
                          {d.count}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-2 rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-400 dark:border-gray-700">
                  暂无文章
                </p>
              )}
            </div>
          </div>
        </section>
      )}

      {/* AI 站点统计 */}
      <section className="card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-gray-800">
              <svg
                className="h-4 w-4 text-gray-500"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"
                />
              </svg>
              AI 站点统计
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              基于当前站点数据，用 AI 生成运营分析报告
            </p>
          </div>
          <button
            onClick={runAiReport}
            disabled={aiLoading}
            className={btnPrimary}
          >
            {aiLoading ? (
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
            ) : (
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"
                />
              </svg>
            )}
            {aiLoading ? "分析中…" : "生成 AI 报告"}
          </button>
        </div>

        {report ? (
          <div className="mt-5 overflow-hidden rounded-2xl border border-gray-100 dark:border-gray-800">
            <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50/60 px-4 py-2 dark:border-gray-800 dark:bg-gray-800/60">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                AI 分析结果
              </span>
              <button
                onClick={copyReport}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-300"
              >
                {copied ? "已复制 ✓" : "复制"}
              </button>
            </div>
            <div className="whitespace-pre-wrap px-5 py-4 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
              {report}
            </div>
          </div>
        ) : (
          <div className="mt-5 rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 px-5 py-8 text-center text-sm text-gray-400 dark:border-gray-700 dark:bg-gray-800/50">
            {aiLoading
              ? "正在分析站点数据…"
              : "点击「生成 AI 报告」，AI 会根据文章/分类/标签等数据给出运营建议。首次使用请先在「站点设置 → AI 改写」配置接口。"}
          </div>
        )}
      </section>

      {/* 快捷入口 */}
      <div>
        <h2 className="mb-3 text-base font-medium text-gray-700 dark:text-gray-300">
          快捷入口
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {links.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className="group flex items-center justify-between rounded-2xl border border-gray-200 bg-white p-4 transition hover:-translate-y-1 hover:border-gray-300 hover:shadow-sm dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
            >
              <div>
                <h3 className="text-base font-medium text-gray-800 dark:text-gray-100">
                  {l.title}
                </h3>
                <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                  {l.desc}
                </p>
              </div>
              <span className="text-gray-300 transition group-hover:translate-x-0.5 dark:text-gray-600">
                →
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
