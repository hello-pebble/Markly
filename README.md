# Markly

Markdown 문법을 몰라도 문서를 고칠 수 있는 위지위그(WYSIWYG) Markdown 편집기입니다.

## 주요 기능

- **서식 편집** — 굵게·기울임·취소선, 제목(H1–H3), 인용문, 코드 블록, 목록을 버튼 또는 단축키로 적용
- **표 편집** — 표 삽입, 행·열 추가, 표 삭제를 셀 안에서 바로 실행
- **링크 삽입** — 모달·`prompt()` 없이 툴바 아래 인라인 입력창으로 링크 연결/해제
- **Markdown 원문 보기** — 편집 화면과 Markdown 원문을 오가며 직접 수정 가능, Jekyll 프론트매터(`---`)는 그대로 보존
- **자동 저장** — 편집 중인 문서를 `localStorage`에 주기적으로 저장하고, 새로고침 시 복원할지 물어보는 배너를 표시
- **파일 열기/다운로드** — 로컬 `.md` 파일을 불러오거나 현재 문서를 `.md`로 저장
- 오류·경고는 브라우저 기본 `alert`/`confirm` 대신 토스트 알림으로 표시

## 기술 스택

- [React](https://react.dev/) 19 + TypeScript
- [Tiptap](https://tiptap.dev/) — 편집 영역(ProseMirror 기반)
- [marked](https://marked.js.org/) + [DOMPurify](https://github.com/cure53/DOMPurify) — Markdown → HTML 변환 및 정제
- [Turndown](https://github.com/mixmark-io/turndown) (+ GFM 플러그인) — HTML → Markdown 변환
- [Vite](https://vitejs.dev/) — 개발 서버 및 빌드

## 시작하기

```bash
npm install
npm run dev
```

기본적으로 `http://localhost:5173`에서 실행됩니다.

### 빌드

```bash
npm run build
```

`tsc -b`로 타입을 검사한 뒤 `dist/`에 프로덕션 빌드를 생성합니다.

### 미리보기

```bash
npm run preview
```

빌드 결과물을 로컬에서 미리 확인합니다.

## 프로젝트 구조

```
src/
  App.tsx        # 툴바, 편집 영역, 자동 저장, 토스트 등 전체 UI/로직
  markdown.ts     # Markdown ↔ HTML 변환, 프론트매터 분리/결합
  styles.css      # 전체 스타일
```

## 참고

- 자동 저장은 브라우저 `localStorage` (`markly:draft:v1` 키)를 사용하므로 기기·브라우저 간 동기화는 되지 않습니다.
- 시크릿 모드 등 `localStorage`를 사용할 수 없는 환경에서는 자동 저장이 조용히 비활성화됩니다.
