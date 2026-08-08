import { useCallback, useEffect, useState } from "react";
import { backupApi } from "../../lib/api";
import type { BackupItem } from "../../lib/types";
import {
  EmptyState,
  PageHeader,
  Skeleton,
  btnPrimary,
} from "../../components/ui";
import { ConfirmDialog } from "../../components/Modal";
import { useToast } from "../../lib/toast";
import { formatDate } from "../../lib/format";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function BackupManage() {
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<BackupItem | null>(null);
  const [busy, setBusy] = useState(false);
  const { success, error } = useToast();

  const load = useCallback(() => {
    setLoading(true);
    backupApi
      .list()
      .then(setBackups)
      .catch(() => setBackups([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    setCreating(true);
    try {
      await backupApi.create();
      success("备份已创建");
      load();
    } catch (e) {
      error(e instanceof Error ? e.message : "创建失败");
    } finally {
      setCreating(false);
    }
  };

  const download = async (b: BackupItem) => {
    setDownloading(b.name);
    try {
      await backupApi.download(b.name);
    } catch (e) {
      error(e instanceof Error ? e.message : "下载失败");
    } finally {
      setDownloading(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await backupApi.remove(deleting.name);
      success("备份已删除");
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
        title="站点备份"
        desc="创建数据库备份，下载保存到本地或删除旧备份"
        action={
          <button onClick={create} disabled={creating} className={btnPrimary}>
            {creating ? (
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
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z"
                />
              </svg>
            )}
            {creating ? "备份中…" : "创建备份"}
          </button>
        }
      />

      {loading ? (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : backups.length === 0 ? (
        <EmptyState
          title="暂无备份"
          description="点击右上角「创建备份」生成数据库快照"
          action={
            <button onClick={create} disabled={creating} className={btnPrimary}>
              创建备份
            </button>
          }
        />
      ) : (
        <div className="space-y-3">
          {backups.map((b) => (
            <div
              key={b.name}
              className="card flex items-center justify-between gap-3 p-4"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-content-center rounded-xl bg-gray-100 text-gray-400 dark:bg-gray-800">
                  <svg
                    className="h-5 w-5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 5.625c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125"
                    />
                  </svg>
                </span>
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm font-medium text-gray-800 dark:text-gray-100">
                    {b.name}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-400">
                    {formatSize(b.size)} · {formatDate(b.created)}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  onClick={() => download(b)}
                  disabled={downloading === b.name}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 transition hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  {downloading === b.name ? "下载中…" : "下载"}
                </button>
                <button
                  onClick={() => setDeleting(b)}
                  className="rounded-lg px-3 py-1.5 text-xs text-red-500 transition hover:bg-red-50 dark:hover:bg-red-500/10"
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
        title="删除备份"
        message={`确定要删除备份「${deleting?.name}」吗？此操作不可恢复。`}
        confirmText={busy ? "删除中..." : "删除"}
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
