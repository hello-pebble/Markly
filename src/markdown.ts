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

export function htmlToMarkdown(html: string) { return turndown.turndown(html).trimEnd() + '\n' }

export function splitFrontMatter(markdown: string) {
  if (!markdown.startsWith('---\n') && !markdown.startsWith('---\r\n')) return { frontMatter: '', body: markdown }
  const closingMarker = markdown.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  if (!closingMarker) return { frontMatter: '', body: markdown }
  return { frontMatter: closingMarker[0].trimEnd(), body: markdown.slice(closingMarker[0].length) }
}

export function joinFrontMatter(frontMatter: string, bodyMarkdown: string) {
  return frontMatter ? `${frontMatter}\n\n${bodyMarkdown}` : bodyMarkdown
}
