# 나의 할 일 — AI 연동 Todo 웹 서비스

로그인 기반 다중 사용자 Todo 웹앱. 기본 할 일 관리에 더해 **Claude(AI)가 MCP·Skill로 직접
할 일을 관리**하고 **매일 아침 브리핑**(날씨·환율·뉴스·할 일)까지 만들어줍니다.

> 📄 기획 문서: **[PRD.md](PRD.md)** (문제정의·타겟유저·MVP·화면·데이터구조)
> 📂 앱 코드: **[todo-app/](todo-app/)** — 자세한 실행법은 [todo-app/README.md](todo-app/README.md)

## 핵심 기능

- **회원가입 / 로그인** — 비밀번호 해시(scrypt) + 세션 쿠키, 사용자별 데이터 분리
- **할 일 CRUD** — 추가/조회/완료/삭제, 마감일 배지, 태그(N:M), 검색, 오늘 필터
- **구글 캘린더 추가** — 마감일 있는 할 일을 캘린더에 등록

## 새로운 시도 (확장)

- **MCP 서버** — Claude가 도구 6개로 할 일을 직접 조작 (`add_todo` 등)
- **Skill 2종** — `todo`(자연어 → 할 일), `daily-briefing`(아침 브리핑)
- **카카오톡 전송** — 브리핑 요약을 "나에게 보내기"
- **인터넷 배포** — Cloudflare 터널로 공개 HTTPS URL (SQLite 데이터는 로컬 유지)

## 기술 스택

| 구분 | 기술 |
|------|------|
| 프론트엔드 | HTML / CSS / 순수 JavaScript |
| 백엔드 | Node.js + Express |
| DB | SQLite (`node:sqlite`) |
| 인증 | scrypt 해시 + 세션 쿠키 (외부 의존성 없음) |
| AI 연동 | MCP + Claude Code Skill |
| 배포 | Cloudflare 터널 |

## 실행

```bash
cd todo-app
npm install
npm start
```

브라우저에서 http://localhost:3456 → 회원가입 후 사용. (자세한 내용은 [todo-app/README.md](todo-app/README.md))
