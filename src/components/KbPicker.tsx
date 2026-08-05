import { useState } from "react";
import { createPortal } from "react-dom";

interface KbNote { id: string; title: string; content: string; createdAt: number; }

export function KbPicker({
  selected, onToggle, onInsert, onClose, onOpenAgent,
}: {
  selected: string[]; onToggle: (id: string) => void;
  onInsert: (notes: KbNote[]) => void; onClose: () => void; onOpenAgent: () => void;
}) {
  const [notes] = useState<KbNote[]>(() => {
    try { return JSON.parse(localStorage.getItem("kimo_kb_notes") || "[]"); }
    catch { return []; }
  });
  const picked = notes.filter(n => selected.includes(n.id));
  return createPortal(
    <div className="fixed bottom-20 left-4 right-4 z-[100] mx-auto max-w-lg rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900 sm:left-16 sm:right-auto sm:w-96">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800">
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">知识库条目</span>
        <button onClick={onClose} className="rounded p-1 text-gray-400 hover:text-gray-600">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
      <div className="max-h-60 overflow-y-auto p-2">
        {notes.length === 0 ? (
          <p className="py-6 text-center text-xs text-gray-400">暂无条目，请在 Agent 编辑器中创建</p>
        ) : notes.map((n) => (
          <label key={n.id} className="flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800">
            <input type="checkbox" checked={selected.includes(n.id)} onChange={() => onToggle(n.id)}
              className="mt-0.5 h-4 w-4 accent-gray-900" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">{n.title}</p>
              <p className="text-xs text-gray-400 line-clamp-2">{n.content.slice(0, 100)}</p>
            </div>
          </label>
        ))}
      </div>
      <div className="flex items-center justify-between border-t border-gray-100 px-4 py-2 dark:border-gray-800">
        <button onClick={() => { onOpenAgent(); onClose(); }}
          className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">打开完整面板</button>
        <button onClick={() => onInsert(picked)} disabled={picked.length === 0}
          className="rounded-lg bg-gray-900 px-4 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-30 dark:bg-gray-200 dark:text-gray-900">
          插入选中 ({picked.length})
        </button>
      </div>
    </div>,
    document.body,
  );
}
