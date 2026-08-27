import { ChangeEvent, useRef, useState } from 'react'
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

export default function App() {
  // useState: 화면이 다시 그려져야 하는 값(문서와 화면 모드)을 React가 기억합니다.
  const [html, setHtml] = useState(() => markdownToHtml(starterMarkdown))
  const [frontMatter, setFrontMatter] = useState('')
  const [showSource, setShowSource] = useState(false)
  const [sourceDraft, setSourceDraft] = useState('')
  const [fileName, setFileName] = useState('새 문서')
  const editorRef = useRef<HTMLDivElement>(null)
  // useRef: 입력 중인 HTML은 React를 다시 렌더링하지 않고 DOM에 유지합니다.
  // 그래서 브라우저가 관리하는 커서와 한글 조합 상태가 끊기지 않습니다.
  const editorHtmlRef = useRef('')
  // useRef: 표 안에서 마지막으로 작업한 위치를 다시 렌더링 없이 기억합니다.
  const activeTableRef = useRef<HTMLTableElement | null>(null)

  function currentHtml() { return editorRef.current?.innerHTML ?? (editorHtmlRef.current || html) }
  function currentMarkdown() { return joinFrontMatter(frontMatter, htmlToMarkdown(currentHtml())) }
  function syncFromEditor() { if (editorRef.current) editorHtmlRef.current = editorRef.current.innerHTML }
  function replaceEditorHtml(nextHtml: string) { editorHtmlRef.current = nextHtml; setHtml(nextHtml) }
  function openSource() { setSourceDraft(currentMarkdown()); setShowSource(true) }
  function applySource() {
    const imported = splitFrontMatter(sourceDraft)
    setFrontMatter(imported.frontMatter)
    replaceEditorHtml(markdownToHtml(imported.body))
    setShowSource(false)
  }
  function run(command: Command) { editorRef.current?.focus(); document.execCommand(command); syncFromEditor() }
  function formatBlock(tag: 'h1' | 'h2' | 'h3' | 'blockquote' | 'pre') { editorRef.current?.focus(); document.execCommand('formatBlock', false, tag); syncFromEditor() }

  function addLink() {
    const url = window.prompt('연결할 주소를 입력하세요.')
    if (!url) return
    editorRef.current?.focus(); document.execCommand('createLink', false, url); syncFromEditor()
  }
  function insertTable() {
    const rows = Math.min(10, Math.max(1, Number(window.prompt('행 수를 입력하세요.', '3')) || 3))
    const columns = Math.min(8, Math.max(1, Number(window.prompt('열 수를 입력하세요.', '3')) || 3))
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
    const table = selectedTable(); if (!table) return window.alert('먼저 수정할 표 안의 셀을 클릭하세요.')
    const cells = table.rows[0]?.cells.length ?? 1; const row = table.insertRow(-1)
    Array.from({ length: cells }, () => row.insertCell().textContent = '내용'); syncFromEditor()
  }
  function addTableColumn() {
    const table = selectedTable(); if (!table) return window.alert('먼저 수정할 표 안의 셀을 클릭하세요.')
    Array.from(table.rows).forEach((row, index) => { const cell = document.createElement(index === 0 ? 'th' : 'td'); cell.textContent = index === 0 ? '새 제목' : '내용'; row.append(cell) }); syncFromEditor()
  }
  function deleteTable() { const table = selectedTable(); if (!table) return window.alert('먼저 삭제할 표 안의 셀을 클릭하세요.'); table.remove(); syncFromEditor() }
  function openFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = () => { const imported = splitFrontMatter(String(reader.result)); setFrontMatter(imported.frontMatter); replaceEditorHtml(markdownToHtml(imported.body)); setShowSource(false); setFileName(file.name.replace(/\.md$/i, '') || '문서') }
    reader.readAsText(file); event.target.value = ''
  }
  function download() {
    const blob = new Blob([currentMarkdown()], { type: 'text/markdown;charset=utf-8' }); const url = URL.createObjectURL(blob); const link = document.createElement('a')
    link.href = url; link.download = `${fileName || '문서'}.md`; link.click(); URL.revokeObjectURL(url)
  }

  return <main className="app-shell">
    <header><div><p className="eyebrow">MARKLY</p><input aria-label="문서 제목" value={fileName} onChange={(e) => setFileName(e.target.value)} /></div><div className="header-actions"><label className="file-button">.md 열기<input type="file" accept=".md,text/markdown" onChange={openFile} /></label><button className="primary" onClick={download}>.md 다운로드</button></div></header>
    <section className="toolbar" aria-label="문서 서식 도구">
      <button onClick={() => run('bold')}><b>B</b><span>굵게</span></button><button onClick={() => run('italic')}><i>I</i><span>기울임</span></button><button onClick={() => run('strikeThrough')}><s>S</s><span>취소선</span></button><div className="divider" />
      <button onClick={() => formatBlock('h1')}>H1</button><button onClick={() => formatBlock('h2')}>H2</button><button onClick={() => formatBlock('h3')}>H3</button><button onClick={() => formatBlock('blockquote')}>인용</button><button onClick={() => formatBlock('pre')}>{'</>'}</button><div className="divider" />
      <button onClick={() => run('insertUnorderedList')}>• 목록</button><button onClick={() => run('insertOrderedList')}>1. 목록</button><button onClick={addLink}>링크</button><div className="divider" />
      <button onClick={insertTable}>＋ 표 삽입</button><button onClick={addTableRow}>행 추가</button><button onClick={addTableColumn}>열 추가</button><button className="danger" onClick={deleteTable}>표 삭제</button>
    </section>
    <div className="mode-switch"><button className={!showSource ? 'active' : ''} onClick={() => showSource && applySource()}>편집</button><button className={showSource ? 'active' : ''} onClick={openSource}>Markdown 원문</button>{showSource && <button className="apply-source" onClick={applySource}>변경사항 반영</button>}</div>
    {showSource ? <textarea className="source-view" aria-label="Markdown 원문 편집기" value={sourceDraft} onChange={(event) => setSourceDraft(event.target.value)} spellCheck={false} /> : <article ref={editorRef} className="editor" contentEditable suppressContentEditableWarning onInput={syncFromEditor} onMouseUp={(event) => rememberActiveTable(event.target)} onKeyUp={(event) => rememberActiveTable(event.target)} dangerouslySetInnerHTML={{ __html: html }} />}
    <p className="hint">문서를 클릭해서 바로 수정하세요. 표 안의 셀을 클릭한 뒤 행·열을 추가할 수 있습니다.{frontMatter && ' Jekyll 메타데이터는 별도로 보존됩니다.'}</p>
  </main>
}
