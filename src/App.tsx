import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
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

type Command = 'bold' | 'italic' | 'strikeThrough' | 'insertUnorderedList' | 'insertOrderedList'

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

export default function App() {
  // useState: 화면이 다시 그려져야 하는 값(문서와 화면 모드)을 React가 기억합니다.
  const [html, setHtml] = useState(() => markdownToHtml(starterMarkdown))
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
  // useMemo: 같은 객체를 넘겨야 React가 본문 innerHTML을 다시 덮어쓰지 않습니다.
  // 그렇지 않으면 다른 상태가 바뀔 때마다 편집 중이던 내용과 커서가 사라집니다.
  const editorHtml = useMemo(() => ({ __html: html }), [html])
  const editorRef = useRef<HTMLDivElement>(null)
  const linkInputRef = useRef<HTMLInputElement>(null)
  // useRef: 링크 입력창으로 포커스가 옮겨가도 원래 선택 영역을 되돌리기 위해 보관합니다.
  const savedRangeRef = useRef<Range | null>(null)
  // useRef: 본문 안에서 마지막으로 잡힌 선택 범위(툴바 클릭으로 풀리기 전 값)입니다.
  const lastRangeRef = useRef<Range | null>(null)
  const toastIdRef = useRef(0)
  // useRef: 입력 중인 HTML은 React를 다시 렌더링하지 않고 DOM에 유지합니다.
  // 그래서 브라우저가 관리하는 커서와 한글 조합 상태가 끊기지 않습니다.
  const editorHtmlRef = useRef('')
  // useRef: 표 안에서 마지막으로 작업한 위치를 다시 렌더링 없이 기억합니다.
  const activeTableRef = useRef<HTMLTableElement | null>(null)
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
    replaceEditorHtml(markdownToHtml(imported.body))
    setFileName(restoredFileName)
    frontMatterRef.current = restoredFrontMatter; fileNameRef.current = restoredFileName
    pendingDraftRef.current = null; setPendingDraft(null)
    notify('임시 저장된 문서를 불러왔습니다.')
  }
  function discardDraft() { pendingDraftRef.current = null; clearDraft(); setPendingDraft(null) }
  function currentHtml() { return editorRef.current?.innerHTML ?? (editorHtmlRef.current || html) }
  function currentMarkdown() { return joinFrontMatter(frontMatter, htmlToMarkdown(currentHtml())) }
  function syncFromEditor() { if (editorRef.current) { editorHtmlRef.current = editorRef.current.innerHTML; scheduleDraftSave() } }
  function replaceEditorHtml(nextHtml: string) {
    // 본문을 통째로 갈아끼우면 이전 DOM을 가리키던 위치 기억은 모두 버립니다.
    editorHtmlRef.current = nextHtml; lastRangeRef.current = null; savedRangeRef.current = null; activeTableRef.current = null
    setHtml(nextHtml)
  }
  function currentElement() {
    const node = window.getSelection()?.anchorNode
    return node instanceof Element ? node : node?.parentElement ?? null
  }
  function placeCursor(element: HTMLElement) {
    const selection = window.getSelection(); if (!selection) return
    const range = document.createRange(); range.selectNodeContents(element); range.collapse(true)
    selection.removeAllRanges(); selection.addRange(range)
  }
  function exitToParagraph() {
    const block = currentElement()?.closest('pre, blockquote')
    if (block) {
      const paragraph = document.createElement('p'); paragraph.append(document.createElement('br'))
      block.insertAdjacentElement('afterend', paragraph); placeCursor(paragraph); syncFromEditor(); return
    }
    editorRef.current?.focus(); document.execCommand('formatBlock', false, 'p'); syncFromEditor()
  }
  function handleEditorKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    const element = currentElement()
    const codeBlock = element?.closest('pre')
    if (codeBlock && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); exitToParagraph(); return }
    const quote = element?.closest('blockquote')
    const line = element?.closest('p, div')
    if (quote && event.key === 'Enter' && line?.textContent?.trim() === '') { event.preventDefault(); exitToParagraph() }
  }
  function openSource() { setSourceDraft(currentMarkdown()); setShowSource(true); setLinkDraft(null); savedRangeRef.current = null; lastRangeRef.current = null }
  function applySource() {
    const imported = splitFrontMatter(sourceDraft)
    setFrontMatter(imported.frontMatter)
    replaceEditorHtml(markdownToHtml(imported.body))
    setShowSource(false)
    frontMatterRef.current = imported.frontMatter
    scheduleDraftSave()
  }
  function run(command: Command) { editorRef.current?.focus(); document.execCommand(command); syncFromEditor() }
  function formatBlock(tag: 'h1' | 'h2' | 'h3' | 'blockquote' | 'pre') { editorRef.current?.focus(); document.execCommand('formatBlock', false, tag); syncFromEditor() }

  // 선택 범위를 복제해도 브라우저가 원본과 함께 접어 버리는 경우가 있어, 경계 값으로 새 범위를 만듭니다.
  function snapshotRange(range: Range) {
    const copy = document.createRange()
    copy.setStart(range.startContainer, range.startOffset)
    copy.setEnd(range.endContainer, range.endOffset)
    return copy
  }
  function editorRange(selection: Selection | null) {
    const editor = editorRef.current
    if (!editor || !selection?.rangeCount) return null
    const range = selection.getRangeAt(0)
    return editor.contains(range.commonAncestorContainer) ? range : null
  }
  function openLinkInput() {
    if (showSource) return notify('편집 모드에서 링크를 넣을 수 있습니다.', 'warning')
    // 지금 선택 영역이 본문 밖이면(툴바로 포커스가 옮겨간 경우) 마지막 본문 범위를 씁니다.
    const range = editorRange(window.getSelection()) ?? lastRangeRef.current
    if (!range || !editorRef.current?.contains(range.commonAncestorContainer)) return notify('링크를 넣을 위치를 본문에서 먼저 클릭하세요.', 'warning')
    const node = range.commonAncestorContainer
    const anchor = (node instanceof Element ? node : node.parentElement)?.closest('a')
    if (anchor) range.selectNode(anchor)
    savedRangeRef.current = snapshotRange(range)
    setLinkDraft(anchor?.getAttribute('href') ?? '')
  }
  function closeLinkInput(restoreFocus = true) {
    setLinkDraft(null)
    if (!restoreFocus) return
    const range = savedRangeRef.current
    editorRef.current?.focus()
    if (range) { const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range) }
  }
  function applyLink() {
    const url = normalizeUrl(linkDraft ?? '')
    if (!url) return notify('연결할 주소를 입력하세요.', 'warning')
    const range = savedRangeRef.current
    editorRef.current?.focus()
    if (range) { const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range) }
    // 선택한 글자가 없으면 주소 자체를 링크 글자로 넣어 줍니다.
    if (range?.collapsed) {
      const anchor = document.createElement('a'); anchor.href = url; anchor.textContent = url
      range.insertNode(anchor); placeCursorAfter(anchor)
    } else {
      document.execCommand('createLink', false, url)
    }
    syncFromEditor(); setLinkDraft(null); savedRangeRef.current = null
    notify('링크를 연결했습니다.')
  }
  function removeLink() {
    const range = savedRangeRef.current
    editorRef.current?.focus()
    if (range) { const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range) }
    document.execCommand('unlink'); syncFromEditor(); setLinkDraft(null); savedRangeRef.current = null
    notify('링크를 해제했습니다.')
  }
  function placeCursorAfter(element: HTMLElement) {
    const selection = window.getSelection(); if (!selection) return
    const range = document.createRange(); range.setStartAfter(element); range.collapse(true)
    selection.removeAllRanges(); selection.addRange(range)
  }
  function insertTable() {
    // 모달 없이 바로 쓸 수 있는 3×3 표를 만들고, 행·열 추가로 확장합니다.
    const rows = 3
    const columns = 3
    const header = Array.from({ length: columns }, (_, index) => `<th>제목 ${index + 1}</th>`).join('')
    const body = Array.from({ length: Math.max(0, rows - 1) }, () => `<tr>${Array.from({ length: columns }, () => '<td>내용</td>').join('')}</tr>`).join('')
    editorRef.current?.focus(); document.execCommand('insertHTML', false, `<table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table><p><br></p>`); syncFromEditor()
  }
  function selectedTable() {
    if (activeTableRef.current?.isConnected) return activeTableRef.current
    const node = window.getSelection()?.anchorNode
    const element = node instanceof Element ? node : node?.parentElement
    return element?.closest('table') ?? null
  }
  function rememberActiveTable(target: EventTarget | null) { activeTableRef.current = (target instanceof Element ? target : null)?.closest('table') ?? null }
  function addTableRow() {
    const table = selectedTable(); if (!table) return notify('먼저 수정할 표 안의 셀을 클릭하세요.', 'warning')
    const cells = table.rows[0]?.cells.length ?? 1; const row = table.insertRow(-1)
    Array.from({ length: cells }, () => row.insertCell().textContent = '내용'); syncFromEditor()
  }
  function addTableColumn() {
    const table = selectedTable(); if (!table) return notify('먼저 수정할 표 안의 셀을 클릭하세요.', 'warning')
    Array.from(table.rows).forEach((row, index) => { const cell = document.createElement(index === 0 ? 'th' : 'td'); cell.textContent = index === 0 ? '새 제목' : '내용'; row.append(cell) }); syncFromEditor()
  }
  function deleteTable() {
    const table = selectedTable(); if (!table) return notify('먼저 삭제할 표 안의 셀을 클릭하세요.', 'warning')
    table.remove(); activeTableRef.current = null; syncFromEditor(); notify('표를 삭제했습니다.')
  }
  function openFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const imported = splitFrontMatter(String(reader.result))
      const nextFileName = file.name.replace(/\.md$/i, '') || '문서'
      setFrontMatter(imported.frontMatter); replaceEditorHtml(markdownToHtml(imported.body)); setShowSource(false); setFileName(nextFileName)
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
  // 본문 안 선택 범위를 계속 기억해 두면, 툴바로 포커스가 옮겨가도 되돌릴 수 있습니다.
  useEffect(() => {
    function remember() {
      const range = editorRange(window.getSelection())
      if (range) lastRangeRef.current = snapshotRange(range)
    }
    document.addEventListener('selectionchange', remember)
    return () => document.removeEventListener('selectionchange', remember)
  }, [])
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
      <button onClick={() => run('bold')}><b>B</b><span>굵게</span></button><button onClick={() => run('italic')}><i>I</i><span>기울임</span></button><button onClick={() => run('strikeThrough')}><s>S</s><span>취소선</span></button><div className="divider" />
      <button onClick={() => formatBlock('h1')}>H1</button><button onClick={() => formatBlock('h2')}>H2</button><button onClick={() => formatBlock('h3')}>H3</button><button onClick={() => formatBlock('blockquote')}>인용</button><button onClick={() => formatBlock('pre')}>{'</>'}</button><button onClick={exitToParagraph}>본문</button><div className="divider" />
      <button onClick={() => run('insertUnorderedList')}>• 목록</button><button onClick={() => run('insertOrderedList')}>1. 목록</button><button className={linkBarOpen ? 'active' : ''} onClick={openLinkInput}>링크</button><div className="divider" />
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
      {showSource ? <textarea className="source-view" aria-label="Markdown 원문 편집기" value={sourceDraft} onChange={(event) => setSourceDraft(event.target.value)} spellCheck={false} /> : <article ref={editorRef} className="editor" contentEditable suppressContentEditableWarning onInput={syncFromEditor} onKeyDown={handleEditorKeyDown} onMouseUp={(event) => rememberActiveTable(event.target)} onKeyUp={(event) => rememberActiveTable(event.target)} dangerouslySetInnerHTML={editorHtml} />}
      <p className="hint">문서를 클릭해서 바로 수정하세요. 표 안의 셀을 클릭한 뒤 행·열을 추가할 수 있습니다.{frontMatter && ' Jekyll 메타데이터는 별도로 보존됩니다.'}
        {lastSavedAt && !pendingDraft && <span className="autosave-status"> · 임시 저장됨 {new Date(lastSavedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>}
      </p></div>
    </div>
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => <p key={toast.id} className={`toast ${toast.tone}`}>{toast.message}</p>)}
    </div>
  </main>
}
