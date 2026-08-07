import { useState } from "react";
import { createPortal } from "react-dom";
import {
  DATA_CATEGORIES,
  downloadData,
  importData,
  type DataCategory,
} from "../lib/dataMgr";
import { useToast } from "../lib/toast";

/** 设置页「数据」弹窗：按类别导出 / 导入 本机数据 */
export function DataModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [selected, setSelected] = useState<DataCategory[]>(
    () => DATA_CATEGORIES.map((c) => c.id) as DataCategory[],
  );
  const [importing, setImporting] = useState(false);
  if (!open) return null;

  const toggle = (id: DataCategory) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const doExport = () => {
    if (!selected.length) {
      toast("请至少选择一项数据");
      return;
    }
    downloadData(selected);
    toast("已导出所选数据");
  };

  const doImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setImporting(true);
    const r = new FileReader();
    r.onload = () => {
      try {
        const { imported, errors } = importData(String(r.result || ""));
        if (!imported.length) {
          toast(errors[0] || "导入失败：文件中没有可导入的数据");
        } else {
          toast(
            `已导入 ${imported.length} 类数据（${imported
              .map(
                (id) =>
                  DATA_CATEGORIES.find((c) => c.id === id)?.label || id,
              )
              .join("、")}），刷新后生效`,
          );
        }
      } catch {
        toast("导入失败：文件格式不正确");
      } finally {
        setImporting(false);
        e.target.value = "";
      }
    };
    r.readAsText(f);
  };

  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-sm rounded-3xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            数据管理
          </h3>
          <button
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-full text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
            aria-label="关闭"
          >
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4">
          <p className="mb-3 text-xs leading-relaxed text-gray-400">
            选择要导出或导入的数据类别
          </p>
          <div className="space-y-1.5">
            {DATA_CATEGORIES.map((c) => {
              const on = selected.includes(c.id);
              return (
                <button
                  key={c.id}
                  onClick={() => toggle(c.id)}
                  className="flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition active:scale-[0.99] dark:border-gray-700"
                >
                  <span
                    className={`grid h-5 w-5 shrink-0 place-items-center rounded border transition ${
                      on
                        ? "border-gray-900 bg-gray-900 text-white dark:border-gray-200 dark:bg-gray-200 dark:text-gray-900"
                        : "border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-900"
                    }`}
                  >
                    {on && (
                      <svg
                        className="h-3.5 w-3.5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                      {c.label}
                    </span>
                    <span className="block text-[11px] text-gray-400">
                      {c.desc}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-4 py-3 dark:border-gray-700">
          <label className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300">
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
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
              />
            </svg>
            {importing ? "导入中…" : "导入数据"}
            <input
              type="file"
              accept=".json,application/json"
              onChange={doImport}
              className="hidden"
            />
          </label>
          <button
            onClick={doExport}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gray-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-gray-700 dark:bg-gray-200 dark:text-gray-900 dark:hover:bg-gray-300"
          >
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
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
              />
            </svg>
            导出数据
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
