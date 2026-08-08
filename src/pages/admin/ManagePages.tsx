import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { pageApi } from "../../lib/api";
import type { Page } from "../../lib/types";
import {
  Badge,
  EmptyState,
  PageHeader,
  Skeleton,
  btnPrimary,
  inputCls,
} from "../../components/ui";
import { ConfirmDialog } from "../../components/Modal";
import { useToast } from "../../lib/toast";

const TYPE_TONE: Record<
  string,
  "violet" | "blue" | "green" | "amber" | "gray"
> = {
  markdown: "blue",
  html: "amber",
  list: "green",
  link: "gray",
  "ai-chat": "violet",
};

export function ManagePages() {
  const [pages, setPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<Page | null>(null);
  const [busy, setBusy] = useState(false);
  // 搜索
  const [search, setSearch] = useState("");
  const { success, error } = useToast();

  const load = () => {
    setLoading(true);
    pageApi
      .list()
      .then(setPages)
      .catch(() => setPages([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const filtered = search.trim()
    ? pages.filter((p) =>
        p.name.toLowerCase().includes(search.trim().toLowerCase()),
      )
    : pages;

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await pageApi.remove(deleting.id);
      success("页面已删除");
      setDeleting(null);
      load();
    } catch (e) {
      error(e instanceof Error ? e.message : "删除失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fade-up space-y-5">
      <PageHeader
        title="页面管理"
        desc={`共 ${pages.length} 个自定义页面`}
        action={
          <Link to="/dashboard/pages/new" className={btnPrimary}>
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
            </svg>
            新建页面
          </Link>
        }
      />

      {/* 搜索 */}
      <div className="relative max-w-xs">
        <svg
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
          />
        </svg>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索页面名称…"
          className={`${inputCls} pl-9`}
        />
      </div>

      {loading ? (
        <div className="space-y-4">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={search ? "没有匹配的页面" : "还没有页面"}
          description={
            search
              ? "换个关键词试试吧"
              : "创建 Markdown / List / Link 类型的自定义页面"
          }
          action={
            !search ? (
              <Link
                to="/dashboard/pages/new"
                className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700"
              >
                新建页面
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((p) => (
            <div
              key={p.id}
              className="card card-hover flex items-center justify-between gap-3 p-4"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gray-100 text-sm font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                  #
                </span>
                <div className="min-w-0">
                  <h3 className="truncate font-medium text-gray-800 dark:text-gray-100">
                    {p.name}
                  </h3>
                  <div className="mt-0.5 flex items-center gap-2">
                    <Badge tone={TYPE_TONE[p.type] ?? "gray"}>{p.type}</Badge>
                    {p.type !== "link" && (
                      <Link
                        to={`/page/${p.name}`}
                        target="_blank"
                        className="text-xs text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
                      >
                        预览 →
                      </Link>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Link
                  to={`/dashboard/pages/${p.id}/edit`}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-blue-600 transition hover:bg-blue-50 dark:hover:bg-blue-500/10"
                >
                  编辑
                </Link>
                <button
                  onClick={() => setDeleting(p)}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 dark:hover:bg-red-500/10"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deleting}
        title="删除页面"
        message={`确定要删除页面「${deleting?.name}」吗？`}
        confirmText={busy ? "删除中..." : "删除"}
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
