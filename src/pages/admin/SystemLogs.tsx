import { useEffect, useState } from "react";
import { logApi } from "../../lib/api";
import type { LogItem } from "../../lib/types";
import { Badge, EmptyState, PageHeader, Skeleton } from "../../components/ui";
import { Pagination } from "../../components/Pagination";
import { formatDate } from "../../lib/format";

const ACTION_TONE: Record<string, "blue" | "amber" | "red" | "gray"> = {
  CREATE: "blue",
  UPDATE: "amber",
  DELETE: "red",
};

type ActionFilter = "all" | "CREATE" | "UPDATE" | "DELETE";

export function SystemLogs() {
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPage, setTotalPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ActionFilter>("all");

  const load = (p: number) => {
    setLoading(true);
    logApi
      .list(p, filter === "all" ? undefined : filter)
      .then((res) => {
        setLogs(res.items);
        setTotalPage(res.total_page);
        setTotal(res.total);
      })
      .catch(() => setLogs([]))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    load(page);
  }, [page, filter]);

  return (
    <div className="fade-up space-y-5">
      <PageHeader
        title="操作日志"
        desc={`共 ${total} 条 · 记录管理员对站点内容的增删改操作`}
      />

      {/* 操作类型筛选 */}
      <div className="flex w-fit gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800">
        {(
          [
            { v: "all", l: "全部" },
            { v: "CREATE", l: "创建" },
            { v: "UPDATE", l: "更新" },
            { v: "DELETE", l: "删除" },
          ] as { v: ActionFilter; l: string }[]
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
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : logs.length === 0 ? (
        <EmptyState
          title={filter === "all" ? "暂无操作日志" : "没有匹配的日志"}
          description="管理员对文章/分类/页面等的增删改操作会记录在这里"
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-100 dark:border-gray-800">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-800/60 dark:text-gray-400">
                  <th className="px-4 py-2.5 font-medium">时间</th>
                  <th className="px-4 py-2.5 font-medium">操作者</th>
                  <th className="px-4 py-2.5 font-medium">操作</th>
                  <th className="px-4 py-2.5 font-medium">方法</th>
                  <th className="px-4 py-2.5 font-medium">路径</th>
                  <th className="px-4 py-2.5 font-medium">状态</th>
                  <th className="px-4 py-2.5 font-medium">耗时</th>
                  <th className="px-4 py-2.5 font-medium">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {logs.map((l) => (
                  <tr
                    key={l.id}
                    className="text-gray-700 transition hover:bg-gray-50/60 dark:text-gray-300 dark:hover:bg-gray-800/40"
                  >
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400">
                      {formatDate(l.created)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-gray-800 dark:text-gray-100">
                        {l.username || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={ACTION_TONE[l.action] ?? "gray"}>
                        {l.action}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-500 dark:text-gray-400">
                      {l.method}
                    </td>
                    <td className="max-w-[240px] truncate px-4 py-2.5 font-mono text-xs text-gray-500 dark:text-gray-400">
                      {l.path}
                    </td>
                    <td
                      className={`px-4 py-2.5 text-xs ${
                        l.status >= 400
                          ? "text-red-500"
                          : "text-emerald-600 dark:text-emerald-400"
                      }`}
                    >
                      {l.status}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400">
                      {l.ms}ms
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-400">
                      {l.ip || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 分页 */}
      {!loading && totalPage > 1 && (
        <div className="flex items-center justify-center pt-2">
          <Pagination page={page} totalPage={totalPage} onChange={setPage} />
        </div>
      )}
    </div>
  );
}
