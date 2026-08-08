import { useEffect, useState } from "react";
import { commentApi } from "../../lib/api";
import type { CommentItem } from "../../lib/types";
import { Badge, EmptyState, PageHeader, Skeleton } from "../../components/ui";
import { Pagination } from "../../components/Pagination";
import { ConfirmDialog } from "../../components/Modal";
import { useToast } from "../../lib/toast";
import { formatDate } from "../../lib/format";

const STATUS_TONE: Record<number, "amber" | "green" | "red" | "gray"> = {
  0: "amber",
  1: "green",
  2: "red",
};
const STATUS_LABEL: Record<number, string> = {
  0: "待审核",
  1: "已通过",
  2: "已拒绝",
};

type StatusFilter = "all" | "0" | "1" | "2";

export function CommentManage() {
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPage, setTotalPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<CommentItem | null>(null);
  const { success, error } = useToast();

  const load = (p: number) => {
    setLoading(true);
    commentApi
      .list(p, filter === "all" ? undefined : Number(filter))
      .then((res) => {
        setComments(res.items);
        setTotalPage(res.total_page);
        setTotal(res.total);
      })
      .catch(() => setComments([]))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    load(page);
  }, [page, filter]);

  const setStatus = async (c: CommentItem, status: number) => {
    setBusyId(c.id);
    try {
      await commentApi.updateStatus(c.id, status);
      success(
        status === 1 ? "已通过" : status === 2 ? "已拒绝" : "已改为待审核",
      );
      load(page);
    } catch (e) {
      error(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusyId(deleting.id);
    try {
      await commentApi.remove(deleting.id);
      success("评论已删除");
      setDeleting(null);
      if (comments.length === 1 && page > 1) setPage((p) => p - 1);
      else load(page);
    } catch (e) {
      error(e instanceof Error ? e.message : "删除失败");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fade-up space-y-5">
      <PageHeader
        title="评论管理"
        desc={`共 ${total} 条评论 · 新评论默认为「待审核」，通过后才会在前台展示`}
      />

      {/* 状态筛选 */}
      <div className="flex w-fit gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800">
        {(
          [
            { v: "all", l: "全部" },
            { v: "0", l: "待审核" },
            { v: "1", l: "已通过" },
            { v: "2", l: "已拒绝" },
          ] as { v: StatusFilter; l: string }[]
        ).map((f) => (
          <button
            key={f.v}
            onClick={() => {
              setFilter(f.v);
              setPage(1);
            }}
            className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition ${
              filter === f.v
                ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100"
                : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            {f.l}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : comments.length === 0 ? (
        <EmptyState
          title={filter === "all" ? "暂无评论" : "没有匹配的评论"}
          description="读者在文章下提交的评论会显示在这里"
        />
      ) : (
        <div className="space-y-3">
          {comments.map((c) => (
            <div
              key={c.id}
              className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-start"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="grid h-7 w-7 shrink-0 place-content-center rounded-full bg-gray-100 text-xs font-bold text-gray-500 dark:bg-gray-800 dark:text-gray-300">
                    {(c.username || "U").slice(0, 1).toUpperCase()}
                  </span>
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-100">
                    {c.username || "匿名"}
                  </span>
                  <Badge tone={STATUS_TONE[c.status] ?? "gray"}>
                    {STATUS_LABEL[c.status] ?? c.status}
                  </Badge>
                  <span className="text-xs text-gray-400">
                    文章 #{c.article_id} · {formatDate(c.created)}
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                  {c.content}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:flex-col sm:items-end">
                {c.status !== 1 && (
                  <button
                    onClick={() => setStatus(c, 1)}
                    disabled={busyId === c.id}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-emerald-600 transition hover:bg-emerald-50 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-emerald-400 dark:hover:bg-emerald-500/10"
                  >
                    通过
                  </button>
                )}
                {c.status !== 2 && (
                  <button
                    onClick={() => setStatus(c, 2)}
                    disabled={busyId === c.id}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-amber-600 transition hover:bg-amber-50 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-amber-400 dark:hover:bg-amber-500/10"
                  >
                    拒绝
                  </button>
                )}
                <button
                  onClick={() => setDeleting(c)}
                  disabled={busyId === c.id}
                  className="rounded-lg px-3 py-1.5 text-xs text-red-500 transition hover:bg-red-50 disabled:opacity-60 dark:hover:bg-red-500/10"
                >
                  删除
                </button>
              </div>
            </div>
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
        title="删除评论"
        message={`确定要删除「${deleting?.username || "匿名"}」的这条评论吗？`}
        confirmText={busyId === deleting?.id ? "删除中..." : "删除"}
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
