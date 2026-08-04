import { Component, useEffect, useRef, useState, type ReactNode } from 'react'
import { Editor, useEditor, useEditorState } from '@lobehub/editor/react'
import {
  INSERT_IMAGE_COMMAND,
  ReactBlockPlugin,
  ReactCodeblockPlugin,
  ReactHRPlugin,
  ReactImagePlugin,
  ReactLinkPlugin,
  ReactListPlugin,
  ReactTablePlugin,
} from '@lobehub/editor'
import {
  Bold,
  Check,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Loader2,
  Pilcrow,
  Quote,
  Redo2,
  Sparkles,
  SquareCode,
  Strikethrough,
  Underline,
  Undo2,
  X,
} from 'lucide-react'
import { $createParagraphNode, $getSelection, $isRangeSelection } from 'lexical'
import { $createHeadingNode } from '@lexical/rich-text'
import { $setBlocksType } from '@lexical/selection'
import { resolveAsset, uploadApi } from '../lib/api'
import { polishMarkdown } from '../lib/ai'
import { readingTime } from '../lib/format'

interface MdEditorProps {
  value: string
  onChange: (value: string) => void
  height?: number
  placeholder?: string
  /** 是否显示「AI 润色」按钮（默认开启） */
  aiPolish?: boolean
}

/** 编辑器崩溃时的兜底：降级为纯文本 textarea，避免整页空白 */
class EditorBoundary extends Component<
  { children: ReactNode; onFallback: (v: string) => void; fallbackValue: string },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (this.state.failed) {
      return (
        <textarea
          defaultValue={this.props.fallbackValue}
          onChange={(e) => this.props.onFallback(e.target.value)}
          className="h-full w-full resize-none p-4 font-mono text-sm outline-none"
          placeholder="编辑器加载失败，可在此直接输入 Markdown"
        />
      )
    }
    return this.props.children as ReactNode
  }
}

/** 空文档（JSON 空段落），规避 lobe-editor 对空 markdown 的报错 */
const EMPTY_DOC = {
  root: { type: 'root', children: [{ type: 'paragraph', children: [] }] },
}

type BlockTag = 'paragraph' | 'h1' | 'h2' | 'h3'

export function MdEditor({
  value,
  onChange,
  height = 520,
  placeholder = '在这里输入 Markdown 内容...',
  aiPolish = true,
}: MdEditorProps) {
  const editor = useEditor()
  const toolbar = useEditorState(editor)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const lastMdRef = useRef<string>('')
  const imageInputRef = useRef<HTMLInputElement>(null)

  const [aiState, setAiState] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const [aiMsg, setAiMsg] = useState('')
  const aiTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (aiTimer.current) clearTimeout(aiTimer.current)
    }
  }, [])

  // 标题 / 段落切换（useEditorState 未提供块级 setter，这里直接用 Lexical）
  const applyBlock = (tag: BlockTag) => {
    const lex = editor?.getLexicalEditor()
    if (!lex) return
    lex.focus()
    lex.update(() => {
      const sel = $getSelection()
      if (!$isRangeSelection(sel)) return
      $setBlocksType(sel, () =>
        tag === 'paragraph' ? $createParagraphNode() : $createHeadingNode(tag),
      )
    })
  }

  const pickImage = () => imageInputRef.current?.click()

  const onPickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) editor?.dispatchCommand(INSERT_IMAGE_COMMAND, { file, block: true })
    if (imageInputRef.current) imageInputRef.current.value = ''
  }

  const runPolish = async () => {
    if (!value.trim()) {
      setAiState('error')
      setAiMsg('正文为空，先写点内容再润色吧')
      flashReset()
      return
    }
    setAiState('loading')
    setAiMsg('AI 润色中…')
    try {
      const polished = await polishMarkdown(value)
      onChangeRef.current(polished)
      lastMdRef.current = polished
      setAiState('ok')
      setAiMsg('润色完成，已替换正文')
    } catch (err) {
      setAiState('error')
      setAiMsg(err instanceof Error ? err.message : 'AI 润色失败')
    }
    flashReset()
  }

  // 状态提示 6 秒后自动消失
  const flashReset = () => {
    if (aiTimer.current) clearTimeout(aiTimer.current)
    aiTimer.current = setTimeout(() => {
      setAiState('idle')
      setAiMsg('')
    }, 6000)
  }

  const btnBase =
    'grid h-8 w-8 place-items-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-500'
  const btnActive = 'bg-gray-900 text-white hover:bg-gray-900 hover:text-white'

  const blockBtn = (tag: BlockTag) => {
    const active = toolbar.blockType === tag
    const icons: Record<BlockTag, ReactNode> = {
      paragraph: <Pilcrow className="h-4 w-4" />,
      h1: <Heading1 className="h-4 w-4" />,
      h2: <Heading2 className="h-4 w-4" />,
      h3: <Heading3 className="h-4 w-4" />,
    }
    const labels: Record<BlockTag, string> = {
      paragraph: '正文',
      h1: '一级标题',
      h2: '二级标题',
      h3: '三级标题',
    }
    return (
      <button
        key={tag}
        onClick={() => applyBlock(tag)}
        title={labels[tag]}
        className={`${btnBase} ${active ? btnActive : ''}`}
      >
        {icons[tag]}
      </button>
    )
  }

  const Divider = () => <span className="mx-1 h-5 w-px shrink-0 bg-gray-200" />

  return (
    <div
      className="flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white"
      style={{ height }}
    >
      {/* 工具栏 */}
      <div className="flex flex-none flex-wrap items-center gap-0.5 border-b border-gray-100 bg-gray-50/60 px-2 py-1.5">
        <button onClick={() => toolbar.undo()} disabled={!toolbar.canUndo} title="撤销 (Ctrl+Z)" className={btnBase}>
          <Undo2 className="h-4 w-4" />
        </button>
        <button onClick={() => toolbar.redo()} disabled={!toolbar.canRedo} title="重做 (Ctrl+Y)" className={btnBase}>
          <Redo2 className="h-4 w-4" />
        </button>
        <Divider />

        {/* 行内格式 */}
        <button onClick={() => { editor?.focus(); toolbar.bold() }} title="加粗 (Ctrl+B)" className={`${btnBase} ${toolbar.isBold ? btnActive : ''}`}>
          <Bold className="h-4 w-4" />
        </button>
        <button onClick={() => { editor?.focus(); toolbar.italic() }} title="斜体 (Ctrl+I)" className={`${btnBase} ${toolbar.isItalic ? btnActive : ''}`}>
          <Italic className="h-4 w-4" />
        </button>
        <button onClick={() => { editor?.focus(); toolbar.underline() }} title="下划线 (Ctrl+U)" className={`${btnBase} ${toolbar.isUnderline ? btnActive : ''}`}>
          <Underline className="h-4 w-4" />
        </button>
        <button onClick={() => { editor?.focus(); toolbar.strikethrough() }} title="删除线" className={`${btnBase} ${toolbar.isStrikethrough ? btnActive : ''}`}>
          <Strikethrough className="h-4 w-4" />
        </button>
        <button onClick={() => { editor?.focus(); toolbar.code() }} title="行内代码" className={`${btnBase} ${toolbar.isCode ? btnActive : ''}`}>
          <Code className="h-4 w-4" />
        </button>
        <Divider />

        {/* 块级 */}
        {(['paragraph', 'h1', 'h2', 'h3'] as BlockTag[]).map(blockBtn)}
        <Divider />
        <button onClick={() => { editor?.focus(); toolbar.blockquote() }} title="引用" className={`${btnBase} ${toolbar.isBlockquote ? btnActive : ''}`}>
          <Quote className="h-4 w-4" />
        </button>
        <button onClick={() => { editor?.focus(); toolbar.bulletList() }} title="无序列表" className={`${btnBase} ${toolbar.blockType === 'bullet' ? btnActive : ''}`}>
          <List className="h-4 w-4" />
        </button>
        <button onClick={() => { editor?.focus(); toolbar.numberList() }} title="有序列表" className={`${btnBase} ${toolbar.blockType === 'number' ? btnActive : ''}`}>
          <ListOrdered className="h-4 w-4" />
        </button>
        <button onClick={() => { editor?.focus(); toolbar.checkList() }} title="任务列表" className={`${btnBase} ${toolbar.blockType === 'check' ? btnActive : ''}`}>
          <ListChecks className="h-4 w-4" />
        </button>
        <Divider />

        <button onClick={() => { editor?.focus(); toolbar.codeblock() }} title="代码块" className={`${btnBase} ${toolbar.isCodeblock ? btnActive : ''}`}>
          <SquareCode className="h-4 w-4" />
        </button>
        <button onClick={() => { editor?.focus(); toolbar.insertLink() }} title="插入链接" className={btnBase}>
          <Link2 className="h-4 w-4" />
        </button>
        <button onClick={pickImage} title="插入图片" className={btnBase}>
          <ImageIcon className="h-4 w-4" />
        </button>

        {/* AI 润色（右对齐） */}
        {aiPolish && (
          <>
            <Divider />
            <button
              onClick={runPolish}
              disabled={aiState === 'loading'}
              title="使用 AI 润色正文"
              className="ml-auto flex h-8 items-center gap-1.5 rounded-lg bg-gray-900 px-3 text-xs font-medium text-white transition hover:bg-gray-700 active:scale-[0.98] disabled:opacity-60"
            >
              {aiState === 'loading' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              AI 润色
            </button>
          </>
        )}
        <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={onPickImage} />
      </div>

      {/* 编辑器主体 */}
      <div className="min-h-0 flex-1">
        <EditorBoundary fallbackValue={value} onFallback={onChange}>
          <Editor
            editor={editor}
            // 空/纯空白内容用 JSON 空段落初始化（type 仅挂载时生效，输出仍统一为 markdown）
            // 注意：必须用 trim() 判断，否则纯空白 markdown 会解析出空根节点触发 "editor state is empty"
            type={value.trim() ? 'markdown' : 'json'}
            content={value.trim() ? value : EMPTY_DOC}
            placeholder={placeholder}
            style={{ height: '100%' }}
            onChange={(e) => {
              const md = e.getDocument('markdown')
              const next = typeof md === 'string' ? md : ''
              // 去重：内容未变化时避免无谓重渲染
              if (next !== lastMdRef.current) {
                lastMdRef.current = next
                onChangeRef.current(next)
              }
            }}
            plugins={[
              ReactBlockPlugin,
              ReactListPlugin,
              ReactLinkPlugin,
              ReactTablePlugin,
              ReactHRPlugin,
              ReactCodeblockPlugin,
              Editor.withProps(ReactImagePlugin, {
                handleUpload: async (file: File) => {
                  const res = await uploadApi.image(file)
                  return { url: resolveAsset(res.url) }
                },
              }),
            ]}
          />
        </EditorBoundary>
      </div>

      {/* 底部状态栏 */}
      <div className="flex flex-none items-center justify-between gap-3 border-t border-gray-100 bg-gray-50/60 px-3 py-1.5 text-xs text-gray-400">
        <span>支持 Markdown · 图片可直接粘贴</span>
        <span className="flex items-center gap-3">
          {aiState !== 'idle' && (
            <span
              className={`flex items-center gap-1 ${
                aiState === 'ok'
                  ? 'text-green-600'
                  : aiState === 'error'
                    ? 'text-red-500'
                    : 'text-gray-500'
              }`}
            >
              {aiState === 'loading' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : aiState === 'ok' ? (
                <Check className="h-3 w-3" />
              ) : (
                <X className="h-3 w-3" />
              )}
              {aiMsg}
            </span>
          )}
          <span>
            正文 {value.length} 字 · 约 {readingTime(value)} 分钟
          </span>
        </span>
      </div>
    </div>
  )
}
