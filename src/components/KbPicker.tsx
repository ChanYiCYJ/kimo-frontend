import { useState } from "react";
import { createPortal } from "react-dom";

interface KbNote {
  id: string;
  title: string;
  content: string;
  createdAt: number;
}

export function KbPicker({
  selected,
  onToggle,
  onInsert,
  onClose,
  onOpenAgent,
  webSearchOn,
  onToggleWebSearch,
}: {
  selected: string[];
  onToggle: (id: string) => void;
  onInsert: (notes: KbNote[]) => void;
  onClose: () => void;
  onOpenAgent: () => void;
  webSearchOn: boolean;
  onToggleWebSearch: () => void;
}) {
  const [notes] = useState<KbNote[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("kimo_kb_notes") || "[]");
    } catch {
      return [];
    }
  });
  const [listOpen, setListOpen] = useState(false);
  const picked = notes.filter((n) => selected.includes(n.id));
  return createPortal(
    <div className="fixed bottom-20 left-4 right-4 z-[100] mx-auto max-w-lg overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900 sm:left-16 sm:right-auto sm:w-96">
      <div className="px-3 py-2.5">
        {/* 网络搜索开关（点击直接切换） */}
        <button
          onClick={onToggleWebSearch}
          className={
            "flex w-full items-center justify-between rounded-xl px-3 py-2.5 transition " +
            (webSearchOn
              ? "bg-blue-50 dark:bg-blue-900/30"
              : "hover:bg-gray-100 dark:hover:bg-gray-800")
          }
        >
          <span
            className={
              "flex items-center gap-2.5 text-sm font-medium " +
              (webSearchOn
                ? "text-blue-600 dark:text-blue-400"
                : "text-gray-600 dark:text-gray-300")
            }
          >
            <span
              className={
                "grid h-7 w-7 place-items-center rounded-lg " +
                (webSearchOn
                  ? "bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400"
                  : "bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500")
              }
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="11" cy="11" r="7" />
                <path strokeLinecap="round" d="M21 21l-4.35-4.35" />
              </svg>
            </span>
            网络搜索
          </span>
          <span
            className={
              "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition " +
              (webSearchOn ? "bg-blue-500" : "bg-gray-300 dark:bg-gray-600")
            }
          >
            <span
              className={
                "inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition " +
                (webSearchOn ? "translate-x-[18px]" : "translate-x-1")
              }
            />
          </span>
        </button>
        {/* 知识库条目：可展开/收起 */}
        <button
          onClick={() => setListOpen(!listOpen)}
          className="mt-1 flex w-full items-center justify-between rounded-xl px-3 py-2.5 transition hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <span className="flex items-center gap-2.5 text-sm font-medium text-gray-600 dark:text-gray-300">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500">
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
                  d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
                />
              </svg>
            </span>
            知识库条目
            <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">
              {notes.length}
            </span>
          </span>
          <svg
            className={
              "h-4 w-4 text-gray-400 transition-transform " +
              (listOpen ? "rotate-180" : "")
            }
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path strokeLinecap="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {listOpen && (
          <div className="mt-1 max-h-52 overflow-y-auto">
            {notes.length === 0 ? (
              <p className="py-6 text-center text-xs text-gray-400">
                暂无条目，请在 Agent 编辑器中创建
              </p>
            ) : (
              notes.map((n) => (
                <label
                  key={n.id}
                  className="group flex cursor-pointer items-start gap-2.5 rounded-xl px-3 py-2 transition hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <span
                    className={
                      "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border transition " +
                      (selected.includes(n.id)
                        ? "border-blue-500 bg-blue-500 dark:border-blue-400 dark:bg-blue-400"
                        : "border-gray-300 dark:border-gray-600")
                    }
                  >
                    {selected.includes(n.id) && (
                      <svg
                        className="h-3 w-3 text-white"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    )}
                  </span>
                  <input
                    type="checkbox"
                    checked={selected.includes(n.id)}
                    onChange={() => onToggle(n.id)}
                    className="sr-only"
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={
                        "truncate text-sm font-medium " +
                        (selected.includes(n.id)
                          ? "text-gray-900 dark:text-gray-100"
                          : "text-gray-700 dark:text-gray-200")
                      }
                    >
                      {n.title}
                    </p>
                    <p className="line-clamp-1 text-xs text-gray-400">
                      {n.content.slice(0, 80)}
                    </p>
                  </div>
                </label>
              ))
            )}
          </div>
        )}
      </div>
      {/* 底部 */}
      <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50/60 px-3 py-2 dark:border-gray-800 dark:bg-gray-800/40">
        <button
          onClick={() => {
            onOpenAgent();
            onClose();
          }}
          className="rounded-lg px-2.5 py-1.5 text-xs text-gray-500 transition hover:bg-gray-200/60 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
        >
          打开完整面板
        </button>
        <button
          onClick={() => onInsert(picked)}
          disabled={picked.length === 0}
          className={
            "rounded-lg px-4 py-1.5 text-xs font-medium transition " +
            (picked.length
              ? "bg-blue-500 text-white hover:bg-blue-600 dark:bg-blue-500 dark:text-white dark:hover:bg-blue-600"
              : "cursor-not-allowed bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-600")
          }
        >
          插入选中{picked.length ? ` (${picked.length})` : ""}
        </button>
      </div>
    </div>,
    document.body,
  );
}
