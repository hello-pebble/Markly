import { ChangeEvent, useEffect, useRef, useState } from 'react'
import { Editor, Extension } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableCell } from '@tiptap/extension-table-cell'
import { htmlToMarkdown, joinFrontMatter, markdownToHtml, splitFrontMatter } from './markdown'

const starterMarkdown = `# 새 문서

에이전트가 만든 문서를 **Markdown 문법 없이** 바로 고쳐 보세요.

## 오늘 할 일

- 본문을 클릭해 자유롭게 수정하기
- 위 도구로 제목, 굵게, 목록 만들기
- 표를 넣어 정보를 정리하기

| 기능 | 상태 | 우선순위 |
| --- | --- | --- |
| 기본 서식 | 완료 | 높음 |
| 표 편집 | 진행 중 | 높음 |
`

type Toast = { id: number; message: string; tone: 'info' | 'warning' }
type Draft = { fileName: string; frontMatter: string; markdown: string; savedAt: number }

// 주소창에 넣어도 되는 형태로 다듬습니다. 사용자가 스킴을 빼먹는 경우가 가장 흔합니다.
function normalizeUrl(raw: string) {
  const url = raw.trim()
  if (!url) return ''
  if (/^(https?:|mailto:|tel:|#|\/)/i.test(url)) return url
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(url)) return `mailto:${url}`
  return `https://${url}`
}

const DRAFT_KEY = 'markly:draft:v1'

// localStorage는 시크릿 모드 등에서 던질 수 있어, 읽고 쓰는 모든 곳을 감쌉니다.
function readDraft(): Draft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (typeof parsed?.markdown !== 'string' || typeof parsed?.savedAt !== 'number') return null
    return parsed as Draft
  } catch { return null }
}
function writeDraft(draft: Draft) {
  try { window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)) } catch { /* 저장 공간이 없으면 그냥 건너뜁니다. */ }
}
function clearDraft() {
  try { window.localStorage.removeItem(DRAFT_KEY) } catch { /* 지울 것이 없어도 무시합니다. */ }
}

// 코드 블록·인용문 안에서 Enter(또는 Ctrl/Cmd+Enter)를 누르면 블록 뒤에 새 문단을 만들고 그리로 빠져나갑니다.
function exitToParagraph(editor: Editor | null) {
  if (!editor) return false
  if (editor.isActive('codeBlock') || editor.isActive('blockquote')) {
    const { $from } = editor.state.selection
    let depth = $from.depth
    while (depth > 0 && !['blockquote', 'codeBlock'].includes($from.node(depth).type.name)) depth--
    if (depth > 0) {
      const pos = $from.after(depth)
      editor.chain().focus().insertContentAt(pos, { type: 'paragraph' }).setTextSelection(pos + 1).run()
      return true
    }
  }
  editor.chain().focus().setParagraph().run()
  return true
}

// 코드 블록에서 Ctrl/Cmd+Enter로 빠져나가고, 빈 인용문에서 Enter로 빠져나가는 단축키입니다.
const ExitBlockOnEnter = Extension.create({
  name: 'exitBlockOnEnter',
  addKeyboardShortcuts() {
    return {
      'Mod-Enter': () => (this.editor.isActive('codeBlock') ? exitToParagraph(this.editor) : false),
      Enter: () => {
        const { editor } = this
        if (editor.isActive('blockquote') && editor.state.selection.$from.parent.content.size === 0) {
          return exitToParagraph(editor)
        }
        return false
      },
    }
  },
})

export default function App() {
  // useState: 화면이 다시 그려져야 하는 값(화면 모드 등)을 React가 기억합니다.
  const [frontMatter, setFrontMatter] = useState('')
  const [showSource, setShowSource] = useState(false)
  const [sourceDraft, setSourceDraft] = useState('')
  const [fileName, setFileName] = useState('새 문서')
  // 링크 입력은 모달·prompt 없이 툴바 아래 인라인 막대로 처리합니다.
  const [linkDraft, setLinkDraft] = useState<string | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  // 새로고침 복구용 임시 저장 상태입니다. pendingDraft는 복원 대기 중인 이전 문서를 담습니다.
  const [pendingDraft, setPendingDraft] = useState<Draft | null>(() => readDraft())
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)
  const linkBarOpen = linkDraft !== null
  const linkInputRef = useRef<HTMLInputElement>(null)
  const toastIdRef = useRef(0)
  // useRef: 자동 저장 디바운스 타이머와, 저장 안 된 변경이 있는지 여부입니다.
  const saveTimerRef = useRef<number | null>(null)
  const dirtyRef = useRef(false)
  // useRef: pendingDraft를 setTimeout 콜백에서도 항상 최신 값으로 읽기 위한 사본입니다.
  const pendingDraftRef = useRef<Draft | null>(pendingDraft)
  // useRef: 디바운스된 저장이 실행될 때는 이미 다음 렌더로 넘어가 있을 수 있어,
  // state 대신 항상 최신인 ref에서 제목·프론트매터를 읽습니다.
  const fileNameRef = useRef(fileName)
  const frontMatterRef = useRef(frontMatter)
  fileNameRef.current = fileName
  frontMatterRef.current = frontMatter

  // Tiptap이 실제 편집 영역(선택 범위, 커서, 실행 취소 이력 등)을 전부 관리합니다.
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: false } }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      ExitBlockOnEnter,
    ],
    content: markdownToHtml(starterMarkdown),
    editorProps: { attributes: { class: 'editor' } },
    onUpdate: () => scheduleDraftSave(),
  })

  function notify(message: string, tone: Toast['tone'] = 'info') {
    const id = ++toastIdRef.current
    setToasts((list) => [...list.slice(-2), { id, message, tone }])
    window.setTimeout(() => setToasts((list) => list.filter((toast) => toast.id !== id)), 3200)
  }
  function saveDraftNow() {
    // 복원할지 아직 묻는 중이면 예전 임시 저장을 덮어쓰지 않습니다.
    if (pendingDraftRef.current) return
    if (saveTimerRef.current !== null) { window.clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
    dirtyRef.current = false
    writeDraft({ fileName: fileNameRef.current, frontMatter: frontMatterRef.current, markdown: currentMarkdown(), savedAt: Date.now() })
    setLastSavedAt(Date.now())
  }
  function scheduleDraftSave() {
    // 배너에 답하지 않고 계속 편집하면, 예전 임시 저장은 포기하고 지금 문서를 새로 저장하기 시작합니다.
    if (pendingDraftRef.current) discardDraft()
    dirtyRef.current = true
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(saveDraftNow, 1200)
  }
  function restoreDraft() {
    if (!pendingDraft) return
    const imported = splitFrontMatter(pendingDraft.markdown)
    const restoredFrontMatter = imported.frontMatter || pendingDraft.frontMatter
    const restoredFileName = pendingDraft.fileName || '문서'
    setFrontMatter(restoredFrontMatter)
    editor?.commands.setContent(markdownToHtml(imported.body))
    setFileName(restoredFileName)
    frontMatterRef.current = restoredFrontMatter; fileNameRef.current = restoredFileName
    pendingDraftRef.current = null; setPendingDraft(null)
    notify('임시 저장된 문서를 불러왔습니다.')
  }
  function discardDraft() { pendingDraftRef.current = null; clearDraft(); setPendingDraft(null) }
  function currentHtml() { return editor?.getHTML() ?? '' }
  function currentMarkdown() { return joinFrontMatter(frontMatter, htmlToMarkdown(currentHtml())) }
  function openSource() { setSourceDraft(currentMarkdown()); setShowSource(true); setLinkDraft(null) }
  function applySource() {
    const imported = splitFrontMatter(sourceDraft)
    setFrontMatter(imported.frontMatter)
    editor?.commands.setContent(markdownToHtml(imported.body))
    setShowSource(false)
    frontMatterRef.current = imported.frontMatter
    scheduleDraftSave()
  }

  function openLinkInput() {
    if (showSource || !editor) return notify('편집 모드에서 링크를 넣을 수 있습니다.', 'warning')
    const href = editor.getAttributes('link').href
    setLinkDraft(typeof href === 'string' ? href : '')
  }
  function closeLinkInput(restoreFocus = true) {
    setLinkDraft(null)
    if (restoreFocus) editor?.chain().focus().run()
  }
  function applyLink() {
    if (!editor) return
    const url = normalizeUrl(linkDraft ?? '')
    if (!url) return notify('연결할 주소를 입력하세요.', 'warning')
    const { from, to } = editor.state.selection
    // 선택한 글자가 없으면 주소 자체를 링크 글자로 넣어 줍니다.
    if (from === to) {
      editor.chain().focus().insertContent({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] }).run()
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
    }
    setLinkDraft(null)
    notify('링크를 연결했습니다.')
  }
  function removeLink() {
    if (!editor) return
    editor.chain().focus().extendMarkRange('link').unsetLink().run()
    setLinkDraft(null)
    notify('링크를 해제했습니다.')
  }

  function insertTable() {
    editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
  }
  function addTableRow() {
    if (!editor?.can().addRowAfter()) return notify('먼저 수정할 표 안의 셀을 클릭하세요.', 'warning')
    editor.chain().focus().addRowAfter().run()
  }
  function addTableColumn() {
    if (!editor?.can().addColumnAfter()) return notify('먼저 수정할 표 안의 셀을 클릭하세요.', 'warning')
    editor.chain().focus().addColumnAfter().run()
  }
  function deleteTable() {
    if (!editor?.can().deleteTable()) return notify('먼저 삭제할 표 안의 셀을 클릭하세요.', 'warning')
    editor.chain().focus().deleteTable().run()
    notify('표를 삭제했습니다.')
  }

  function openFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const imported = splitFrontMatter(String(reader.result))
      const nextFileName = file.name.replace(/\.md$/i, '') || '문서'
      setFrontMatter(imported.frontMatter); editor?.commands.setContent(markdownToHtml(imported.body)); setShowSource(false); setFileName(nextFileName)
      frontMatterRef.current = imported.frontMatter; fileNameRef.current = nextFileName
      scheduleDraftSave()
    }
    reader.readAsText(file); event.target.value = ''
  }
  function download() {
    const blob = new Blob([currentMarkdown()], { type: 'text/markdown;charset=utf-8' }); const url = URL.createObjectURL(blob); const link = document.createElement('a')
    link.href = url; link.download = `${fileName || '문서'}.md`; link.click()
    // 곧바로 해제하면 브라우저가 파일 이름을 놓치는 경우가 있어 한 박자 뒤에 정리합니다.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    notify(`${fileName || '문서'}.md 파일을 저장했습니다.`)
  }

  // 링크 입력창이 열리면 곧바로 타이핑할 수 있게 포커스를 옮깁니다.
  useEffect(() => { if (linkBarOpen) linkInputRef.current?.select() }, [linkBarOpen])
  // 탭을 닫거나 새로고침하기 직전에 밀린 변경 사항을 마지막으로 저장합니다.
  useEffect(() => {
    function flush() { if (dirtyRef.current) saveDraftNow() }
    window.addEventListener('beforeunload', flush)
    window.addEventListener('visibilitychange', flush)
    return () => { window.removeEventListener('beforeunload', flush); window.removeEventListener('visibilitychange', flush) }
  }, [])

  return <main className="app-shell">
    <header><div><p className="eyebrow">MARKLY</p><input aria-label="문서 제목" value={fileName} onChange={(e) => { setFileName(e.target.value); scheduleDraftSave() }} /></div><div className="header-actions"><label className="file-button">.md 열기<input type="file" accept=".md,text/markdown" onChange={openFile} /></label><button className="primary" onClick={download}>.md 다운로드</button></div></header>
    {pendingDraft && <div className="draft-banner" role="status">
      <p>새로고침 전에 작업하던 문서가 남아 있습니다. ({new Date(pendingDraft.savedAt).toLocaleString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 임시 저장)</p>
      <button className="primary" onClick={restoreDraft}>불러오기</button>
      <button onClick={discardDraft}>새로 시작</button>
    </div>}
    {/* 툴바를 눌러도 본문 선택이 풀리지 않도록 기본 포커스 이동을 막습니다. */}
    <section className="toolbar" aria-label="문서 서식 도구" onMouseDown={(event) => { if (event.target !== event.currentTarget) event.preventDefault() }}>
      <button onClick={() => editor?.chain().focus().toggleBold().run()}><b>B</b><span>굵게</span></button><button onClick={() => editor?.chain().focus().toggleItalic().run()}><i>I</i><span>기울임</span></button><button onClick={() => editor?.chain().focus().toggleStrike().run()}><s>S</s><span>취소선</span></button><div className="divider" />
      <button onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}>H1</button><button onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>H2</button><button onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}>H3</button><button onClick={() => editor?.chain().focus().toggleBlockquote().run()}>인용</button><button onClick={() => editor?.chain().focus().toggleCodeBlock().run()}>{'</>'}</button><button onClick={() => exitToParagraph(editor)}>본문</button><div className="divider" />
      <button onClick={() => editor?.chain().focus().toggleBulletList().run()}>• 목록</button><button onClick={() => editor?.chain().focus().toggleOrderedList().run()}>1. 목록</button><button className={linkBarOpen ? 'active' : ''} onClick={openLinkInput}>링크</button><div className="divider" />
      <button onClick={insertTable}>＋ 표 삽입</button><button onClick={addTableRow}>행 추가</button><button onClick={addTableColumn}>열 추가</button><button className="danger" onClick={deleteTable}>표 삭제</button>
    </section>
    {linkBarOpen && <div className="link-bar" role="group" aria-label="링크 주소 입력">
      <label htmlFor="link-url">주소</label>
      <input id="link-url" ref={linkInputRef} value={linkDraft} placeholder="example.com 또는 https://example.com"
        onChange={(event) => setLinkDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); applyLink() }
          if (event.key === 'Escape') { event.preventDefault(); closeLinkInput() }
        }} />
      <button className="primary" onClick={applyLink}>연결</button>
      <button onClick={removeLink}>링크 해제</button>
      <button onClick={() => closeLinkInput()}>취소</button>
    </div>}
    <div className="editor-layout">
      <aside className="shortcut-guide" aria-label="편집 단축키 안내"><p>빠른 안내</p><h2>단락 마무리</h2><ul><li><kbd>본문</kbd><span>일반 문단으로 전환</span></li><li><kbd>Enter</kbd><span>제목 종료</span></li><li><kbd>Enter</kbd><span>빈 인용문 종료</span></li><li><kbd>Ctrl + Enter</kbd><span>코드 블록 종료</span></li><li><kbd>Shift + Enter</kbd><span>같은 단락 줄바꿈</span></li></ul><small>macOS에서는 Ctrl 대신 Cmd를 사용하세요.</small></aside>
      <div className="document-area"><div className="mode-switch"><button className={!showSource ? 'active' : ''} onClick={() => showSource && applySource()}>편집</button><button className={showSource ? 'active' : ''} onClick={openSource}>Markdown 원문</button>{showSource && <button className="apply-source" onClick={applySource}>변경사항 반영</button>}</div>
      {showSource ? <textarea className="source-view" aria-label="Markdown 원문 편집기" value={sourceDraft} onChange={(event) => setSourceDraft(event.target.value)} spellCheck={false} /> : <EditorContent editor={editor} />}
      <p className="hint">문서를 클릭해서 바로 수정하세요. 표 안의 셀을 클릭한 뒤 행·열을 추가할 수 있습니다.{frontMatter && ' Jekyll 메타데이터는 별도로 보존됩니다.'}
        {lastSavedAt && !pendingDraft && <span className="autosave-status"> · 임시 저장됨 {new Date(lastSavedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>}
      </p></div>
    </div>
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => <p key={toast.id} className={`toast ${toast.tone}`}>{toast.message}</p>)}
    </div>
  </main>
}
