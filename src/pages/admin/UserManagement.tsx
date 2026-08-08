import { useEffect, useMemo, useState } from "react";
import { userApi } from "../../lib/api";
import type { User } from "../../lib/types";
import {
  EmptyState,
  PageHeader,
  Skeleton,
  inputCls,
} from "../../components/ui";
import { Pagination } from "../../components/Pagination";
import { ConfirmDialog } from "../../components/Modal";
import { useToast } from "../../lib/toast";
import { useAuth } from "../../lib/auth";
import { formatDate } from "../../lib/format";

export function UserManagement() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<User | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  // 搜索 + 本地分页
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;
  const { success, error } = useToast();

  const load = () => {
    setLoading(true);
    userApi
      .list()
      .then(setUsers)
      .catch(() => setUsers([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  // 本地过滤 + 分页
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        (u.user_name || "").toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q),
    );
  }, [users, search]);

  const totalPage = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageUsers = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const toggleRole = async (u: User) => {
    if (u.id === me?.id) {
      error("不能修改自己的权限");
      return;
    }
    setBusyId(u.id);
    try {
      const next = await userApi.setRole(u.id, u.role === 0 ? 1 : 0);
      setUsers((prev) => prev.map((x) => (x.id === u.id ? next : x)));
      success(
        next.role === 0
          ? `已将「${next.user_name || next.email}」设为管理员`
          : `已取消「${next.user_name || next.email}」的管理员权限`,
      );
    } catch (e) {
      error(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    if (deleting.id === me?.id) {
      error("不能删除自己");
      setDeleting(null);
      return;
    }
    setBusyId(deleting.id);
    try {
      await userApi.remove(deleting.id);
      success("用户已删除");
      setDeleting(null);
      setUsers((prev) => prev.filter((x) => x.id !== deleting.id));
    } catch (e) {
      error(e instanceof Error ? e.message : "删除失败");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fade-up space-y-5">
      <PageHeader title="用户管理" desc={`共 ${users.length} 个用户`} />

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
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="搜索用户名 / 邮箱…"
          className={`${inputCls} pl-9`}
        />
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : pageUsers.length === 0 ? (
        <EmptyState
          title={search ? "没有匹配的用户" : "暂无用户"}
          description={search ? "换个关键词试试吧" : "注册用户会显示在这里"}
        />
      ) : (
        <div className="space-y-3">
          {pageUsers.map((u) => (
            <div
              key={u.id}
              className="card card-hover flex items-center justify-between gap-3 p-4"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className={`grid h-10 w-10 shrink-0 place-content-center rounded-full text-sm font-bold ${
                    u.role === 0
                      ? "bg-gray-900 text-white dark:bg-gray-200 dark:text-gray-900"
                      : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                  }`}
                >
                  {(u.user_name || u.email || "U").slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {u.user_name || "未设置用户名"}
                    </p>
                    {u.id === me?.id && (
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
                        我
                      </span>
                    )}
                    {u.role === 0 ? (
                      <span className="rounded-full bg-gray-900 px-2 py-0.5 text-xs text-white dark:bg-gray-200 dark:text-gray-900">
                        管理员
                      </span>
                    ) : (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                        普通用户
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-gray-400">
                    {u.email} · 注册于{" "}
                    {u.created_at ? formatDate(u.created_at) : "—"}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => toggleRole(u)}
                  disabled={busyId === u.id}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 transition hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  {u.role === 0 ? "取消管理员" : "设为管理员"}
                </button>
                <button
                  onClick={() => setDeleting(u)}
                  disabled={busyId === u.id || u.id === me?.id}
                  className="rounded-lg px-3 py-1.5 text-xs text-red-500 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-red-500/10"
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
        title="删除用户"
        message={`确定要删除用户「${deleting?.user_name || deleting?.email}」吗？该操作不可恢复。`}
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
