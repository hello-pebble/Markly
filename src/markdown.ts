import DOMPurify from 'dompurify'
import { marked } from 'marked'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'

// 제목은 구분선과 혼동되지 않도록 # 문법으로 저장합니다.
const turndown = new TurndownService({ bulletListMarker: '-', codeBlockStyle: 'fenced', headingStyle: 'atx' })
turndown.use(gfm)
turndown.keep(['nav', 'div', 'span'])

export function markdownToHtml(markdown: string) {
  return DOMPurify.sanitize(marked.parse(markdown, { gfm: true, breaks: true }) as string)
}

// Tiptap이 만드는 표 HTML은 turndown-plugin-gfm이 그대로 표로 바꿔 주지 못하는 두 가지 특징이 있습니다.
// 1) <div class="tableWrapper">로 감싸여 있어 div 보존 규칙에 걸려 표 전체가 원본 HTML로 남습니다.
// 2) <tbody> 바로 앞에 <colgroup>이 있으면 gfm이 "첫 번째 tbody"로 인식하지 못해 제목 행을 못 찾습니다.
// 변환 전에 두 요소를 정리해 일반적인 <table><tbody><tr><th>...</tr></tbody></table> 모양으로 만듭니다.
function normalizeTablesForMarkdown(html: string) {
  const container = document.createElement('div')
  container.innerHTML = html
  container.querySelectorAll('div.tableWrapper').forEach((wrapper) => wrapper.replaceWith(...wrapper.childNodes))
  container.querySelectorAll('table colgroup').forEach((colgroup) => colgroup.remove())
  // 셀 안의 <p>가 그대로 있으면 turndown이 문단 앞뒤에 빈 줄을 넣어 표 한 줄이 여러 줄로 깨집니다.
  // 문단을 풀어내고, 문단이 여럿이면 그 사이만 <br>로 이어 붙입니다.
  container.querySelectorAll('table th, table td').forEach((cell) => {
    const paragraphs = Array.from(cell.querySelectorAll(':scope > p'))
    paragraphs.forEach((paragraph, index) => {
      if (index > 0) paragraph.before(document.createElement('br'))
      paragraph.replaceWith(...paragraph.childNodes)
    })
  })
  return container.innerHTML
}

export function htmlToMarkdown(html: string) { return turndown.turndown(normalizeTablesForMarkdown(html)).trimEnd() + '\n' }

export function splitFrontMatter(markdown: string) {
  if (!markdown.startsWith('---\n') && !markdown.startsWith('---\r\n')) return { frontMatter: '', body: markdown }
  const closingMarker = markdown.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  if (!closingMarker) return { frontMatter: '', body: markdown }
  return { frontMatter: closingMarker[0].trimEnd(), body: markdown.slice(closingMarker[0].length) }
}

export function joinFrontMatter(frontMatter: string, bodyMarkdown: string) {
  return frontMatter ? `${frontMatter}\n\n${bodyMarkdown}` : bodyMarkdown
}
