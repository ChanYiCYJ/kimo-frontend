import { Component, useRef, type ReactNode } from 'react'
import { Editor, useEditor } from '@lobehub/editor/react'
import {
  ReactBlockPlugin,
  ReactCodeblockPlugin,
  ReactHRPlugin,
  ReactImagePlugin,
  ReactLinkPlugin,
  ReactListPlugin,
  ReactTablePlugin,
} from '@lobehub/editor'
import { resolveAsset, uploadApi } from '../lib/api'

interface MdEditorProps {
  value: string
  onChange: (value: string) => void
  height?: number
  placeholder?: string
}

/** 编辑器崩溃时的兜底：降级为纯文本 textarea，避免整页空白 */
class EditorBoundary extends Component<
  { children: ReactNode; onFallback: (v: string) => void; fallbackValue: string; height: number },
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

/**
 * Markdown 编辑器（lobe-editor：基于 Lexical 的块级编辑器）
 * - 初始内容通过 content 传入（type="markdown"）
 * - 图片上传对接后端 /upload/image
 * - onChange 实时输出 Markdown 文本
 */
/** 空文档（JSON 空段落），规避 lobe-editor 对空 markdown 的报错 */
const EMPTY_DOC = {
  root: { type: 'root', children: [{ type: 'paragraph', children: [] }] },
}

export function MdEditor({ value, onChange, height = 520, placeholder = '在这里输入 Markdown 内容...' }: MdEditorProps) {
  const editor = useEditor()
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const lastMdRef = useRef<string>('')

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white" style={{ height }}>
      <EditorBoundary fallbackValue={value} height={height} onFallback={onChange}>
        <Editor
          editor={editor}
          // 空内容用 JSON 空段落初始化（type 仅挂载时生效，输出仍统一为 markdown）
          type={value ? 'markdown' : 'json'}
          content={value ? value : EMPTY_DOC}
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
  )
}
