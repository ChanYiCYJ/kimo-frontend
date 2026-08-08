import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { articleApi, categoryApi, resolveAsset } from "../../lib/api";
import type { ArticleListItem, Category } from "../../lib/types";
import {
  Badge,
  EmptyState,
  PageHeader,
  Skeleton,
  btnPrimary,
  inputCls,
} from "../../components/ui";
import { Pagination } from "../../components/Pagination";
import { ConfirmDialog } from "../../components/Modal";
import { useToast } from "../../lib/toast";
import { formatDate } from "../../lib/format";

export function ManageArticles() {
  const [articles, setArticles] = useState<ArticleListItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPage, setTotalPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<ArticleListItem | null>(null);
  const [busy, setBusy] = useState(false);
  // 筛选
  const [keyword, setKeyword] = useState("");
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [pageSize, setPageSize] = useState(10);
  const [categories, setCategories] = useState<Category[]>([]);
  const { success, error } = useToast();

  useEffect(() => {
    categoryApi
      .list()
      .then(setCategories)
      .catch(() => {});
  }, []);

  const load = useCallback(
    (p: number) => {
      setLoading(true);
      articleApi
        .list(p, categoryId || undefined, keyword.trim() || undefined, pageSize)
        .then((res) => {
          setArticles(res.items);
          setTotalPage(res.total_page);
          setTotal(res.total);
        })
        .catch(() => setArticles([]))
        .finally(() => setLoading(false));
    },
    [categoryId, keyword, pageSize],
  );

  useEffect(() => {
    load(page);
  }, [load, page]);

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await articleApi.remove(deleting.id);
      success("文章已删除");
      setDeleting(null);
      // 若当前页已删空则回退一页
      if (articles.length === 1 && page > 1) {
        setPage((p) => p - 1);
      } else {
        load(page);
      }
    } catch (e) {
      error(e instanceof Error ? e.message : "删除失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fade-up space-y-5">
      <PageHeader
        title="文章管理"
        desc={`共 ${total} 篇文章`}
        action={
          <Link to="/dashboard/articles/new" className={btnPrimary}>
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
            </svg>
            新建文章
          </Link>
        }
      />

      {/* 搜索 / 筛选工具栏 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
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
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setPage(1)}
            placeholder="搜索文章标题…"
            className={`${inputCls} pl-9`}
          />
        </div>
        <select
          value={categoryId}
          onChange={(e) =>
            setCategoryId(e.target.value === "" ? "" : Number(e.target.value))
          }
          className={`${inputCls} w-auto sm:w-40`}
        >
          <option value="">全部分类</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={pageSize}
          onChange={(e) => setPageSize(Number(e.target.value))}
          className={`${inputCls} w-auto`}
        >
          {[5, 10, 20, 50].map((n) => (
            <option key={n} value={n}>
              {n} 条/页
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : articles.length === 0 ? (
        <EmptyState
          title="还没有文章"
          description="点击右上角「新建文章」发布第一篇吧"
          action={
            <Link
              to="/dashboard/articles/new"
              className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700"
            >
              新建文章
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          {articles.map((a) => (
            <article
              key={a.id}
              className="card card-hover group flex flex-col gap-3 p-4 sm:flex-row sm:items-center"
            >
              {/* 封面缩略图 */}
              {a.cover_image ? (
                <div className="h-16 w-full overflow-hidden rounded-xl bg-gray-100 sm:h-14 sm:w-20 sm:shrink-0 dark:bg-gray-800">
                  <img
                    src={resolveAsset(a.cover_image)}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                </div>
              ) : (
                <div className="hidden h-14 w-20 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-300 sm:flex dark:bg-gray-800">
                  <svg
                    className="h-6 w-6"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25z"
                    />
                  </svg>
                </div>
              )}

              {/* 信息 */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="truncate font-medium text-gray-800 dark:text-gray-100">
                    {a.title}
                  </h3>
                  {a.category_name && (
                    <Badge tone="gray">{a.category_name}</Badge>
                  )}
                </div>
                <p className="mt-1 flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
                  <span>{formatDate(a.created)}</span>
                  {a.tags.length > 0 && (
                    <span className="truncate">
                      {a.tags.map((t) => `#${t.tag_name}`).join(" ")}
                    </span>
                  )}
                </p>
              </div>

              {/* 操作 */}
              <div className="flex shrink-0 items-center gap-1 sm:gap-2">
                <Link
                  to={`/article/${a.id}`}
                  target="_blank"
                  className="rounded-lg px-3 py-2 text-xs font-medium text-gray-500 transition hover:bg-gray-100 active:bg-gray-100 sm:px-3 sm:py-1.5 dark:hover:bg-gray-800"
                >
                  查看
                </Link>
                <Link
                  to={`/dashboard/articles/${a.id}/edit`}
                  className="rounded-lg px-3 py-2 text-xs font-medium text-blue-600 transition hover:bg-blue-50 active:bg-blue-50 sm:px-3 sm:py-1.5 dark:hover:bg-blue-500/10"
                >
                  编辑
                </Link>
                <button
                  onClick={() => setDeleting(a)}
                  className="rounded-lg px-3 py-2 text-xs font-medium text-red-600 transition hover:bg-red-50 active:bg-red-50 sm:px-3 sm:py-1.5 dark:hover:bg-red-500/10"
                >
                  删除
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* 分页 */}
      {!loading && totalPage > 1 && (
        <div className="flex items-center justify-center pt-2">
          <Pagination page={page} totalPage={totalPage} onChange={setPage} />
        </div>
      )}

      <ConfirmDialog
        open={!!deleting}
        title="删除文章"
        message={`确定要删除《${deleting?.title}》吗？此操作不可恢复。`}
        confirmText={busy ? "删除中..." : "删除"}
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
