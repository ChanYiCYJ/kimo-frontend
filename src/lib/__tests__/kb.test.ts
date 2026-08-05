import { describe, it, expect, beforeEach } from "vitest";
import {
  parseKbTool,
  findKbNoteByTitle,
  loadEditorDrafts,
  addEditorDraft,
  removeEditorDraft,
  saveKbEntry,
  loadKbEntries,
  type KbNote,
} from "../kb";

beforeEach(() => {
  localStorage.clear();
});

describe("kb · parseKbTool（AI 创建/编辑知识库指令）", () => {
  it("解析 KB-SAVE（新建/更新）", () => {
    const r = parseKbTool(
      "先保存一下：[KB-SAVE:React 要点]React 是 UI 库[/KB-SAVE]",
    );
    expect(r).toEqual({
      mode: "save",
      title: "React 要点",
      content: "React 是 UI 库",
    });
  });
  it("解析 KB-EDIT（修改）", () => {
    const r = parseKbTool(
      "更新它：[KB-EDIT:React 要点]React 是用于构建界面的库[/KB-EDIT]",
    );
    expect(r).toEqual({
      mode: "edit",
      title: "React 要点",
      content: "React 是用于构建界面的库",
    });
  });
  it("内容可含多行与括号", () => {
    const r = parseKbTool(
      "[KB-SAVE: 部署说明 ]\n# 部署\n- 用 `wrangler deploy`\n[/KB-SAVE]",
    );
    expect(r?.mode).toBe("save");
    expect(r?.title).toBe("部署说明");
    expect(r?.content).toContain("wrangler deploy");
  });
  it("无指令返回 null", () => {
    expect(parseKbTool("普通回复，没有工具调用")).toBeNull();
    expect(parseKbTool("")).toBeNull();
  });
  it("未闭合标签不匹配", () => {
    expect(parseKbTool("[KB-SAVE:标题]没有闭合标签")).toBeNull();
  });
});

describe("kb · findKbNoteByTitle", () => {
  const notes: KbNote[] = [
    { id: "1", title: "React 要点", content: "a", createdAt: 1 },
    { id: "2", title: " 部署说明 ", content: "b", createdAt: 2 },
  ];
  it("忽略大小写与首尾空格匹配", () => {
    expect(findKbNoteByTitle(notes, "react 要点")?.id).toBe("1");
    expect(findKbNoteByTitle(notes, "部署说明")?.id).toBe("2");
  });
  it("未命中返回 undefined", () => {
    expect(findKbNoteByTitle(notes, "不存在")).toBeUndefined();
  });
});

describe("kb · saveKbEntry（AI 保存知识库）", () => {
  it("新建条目并同步到 kimo_kb_notes", () => {
    const e = saveKbEntry("React 要点", "React 是 UI 库");
    expect(e.name).toBe("React 要点");
    expect(loadKbEntries()).toHaveLength(1);
    const notes = JSON.parse(localStorage.getItem("kimo_kb_notes") || "[]");
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe("React 要点");
  });
  it("按标题更新已有条目（忽略大小写/空格，不新增）", () => {
    saveKbEntry("React 要点", "v1");
    const e = saveKbEntry(" react 要点 ", "v2");
    expect(e.content).toBe("v2");
    expect(loadKbEntries()).toHaveLength(1);
    expect(loadKbEntries()[0].content).toBe("v2");
  });
});

describe("kb · 编辑器临时草稿", () => {
  it("默认无草稿", () => {
    expect(loadEditorDrafts()).toEqual([]);
  });
  it("保存后可读取（自动命名）", () => {
    addEditorDraft("第一条内容");
    addEditorDraft("第二条内容", "自定义名");
    const drafts = loadEditorDrafts();
    expect(drafts).toHaveLength(2);
    expect(drafts[0].content).toBe("第二条内容");
    expect(drafts[0].name).toBe("自定义名");
    expect(drafts[1].name).toContain("草稿");
  });
  it("删除草稿", () => {
    addEditorDraft("x");
    const id = loadEditorDrafts()[0].id;
    removeEditorDraft(id);
    expect(loadEditorDrafts()).toEqual([]);
  });
});
