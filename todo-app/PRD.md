# PRD — 나의 할 일 (AI 연동 Todo 웹 서비스)

> Product Requirements Document
> 최종 수정: 2026-07-23

---

## 1. 개요 (Overview)

`localhost`가 아닌 **웹에서 접속 가능한 개인 할 일 관리 서비스**. 기본적인 할 일 CRUD에
더해, **Claude(AI)가 MCP·Skill을 통해 직접 할 일을 관리**하고 **매일 아침 브리핑**까지
만들어주는 것이 차별점이다.

- 한 줄 소개: "말로 할 일을 관리하고, 매일 아침 뉴스·날씨·할 일을 한 번에 받아보는 To-Do"
- 형태: 로그인 기반 다중 사용자 웹앱 (프론트엔드 + REST API + DB)

---

## 2. 문제 정의 (Problem)

- 기존 메모/할 일 앱은 **직접 타이핑해서 입력**해야 해서 번거롭다. "내일까지 보고서" 같은
  자연어를 매번 날짜·제목으로 쪼개 넣어야 한다.
- 할 일, 뉴스, 날씨, 환율을 각각 **다른 앱에서 따로** 확인해야 해서 아침마다 번거롭다.
- 개인이 만든 로컬 앱은 **자기 PC에서만** 돌아 다른 기기·다른 사람이 못 쓴다.

**→ 이 서비스는:** ① 자연어로 말하면 AI가 대신 할 일을 정리해주고, ② 아침 브리핑으로
할 일·뉴스·날씨·환율을 한 화면에 모으고, ③ 웹으로 배포해 어디서든 접속하게 해서 위 문제를 해결한다.

---

## 3. 타겟 유저 (Target Users)

- **주 사용자**: 할 일과 일정을 관리하고 싶은 개인 (학생·직장인). 특히 Claude 같은
  AI 도구를 함께 쓰는 사용자.
- **부 사용자**: 같은 링크로 접속해 각자 계정을 만들어 쓰는 지인·팀원 (다중 사용자 지원).

---

## 4. 핵심 기능 (MVP)

반드시 있어야 할 최소 기능:

| # | 기능 | 설명 |
|---|------|------|
| 1 | **회원가입 / 로그인** | 아이디·비밀번호 기반. 비밀번호는 해시 저장, 세션 쿠키 |
| 2 | **할 일 추가** | 제목 + 마감일 + 태그 |
| 3 | **할 일 목록 조회** | 완료/미완료, 마감일 순 정렬 |
| 4 | **완료 체크 / 삭제** | 상태 토글, 삭제 |
| 5 | **검색 · 필터** | 제목 검색, 태그 필터, "오늘 할 일" 필터 |
| 6 | **사용자별 데이터 분리** | 각자 자기 할 일만 보고 수정 가능 |

**확장(＋) 기능 — 이미 구현:**

| # | 기능 | 설명 |
|---|------|------|
| E1 | **MCP 서버** | Claude가 도구 6개로 할 일을 직접 CRUD (`add_todo`, `list_todos`, `complete_todo`, `delete_todo`, `list_tags`, `send_kakao`) |
| E2 | **Skill: todo** | Claude가 자연어를 해석해 할 일로 등록 ("내일까지 보고서" → 마감일 변환) |
| E3 | **Skill: daily-briefing** | 날씨 + 환율(임계값 알림) + 뉴스 + 오늘 할 일을 아침 브리핑으로 |
| E4 | **카카오톡 전송** | 브리핑 요약을 "나에게 보내기"로 전송 (선택) |
| E5 | **구글 캘린더 추가** | 마감일 있는 할 일을 캘린더에 등록 (TEMPLATE URL) |

---

## 5. 화면 구성 (Screens)

| 화면 | 파일 | 내용 |
|------|------|------|
| **로그인 / 회원가입** | `public/login.html` | 탭 전환형. 아이디·비밀번호 입력, 오류 표시 |
| **할 일 메인** | `public/index.html` | 헤더(사용자명·로그아웃) / 추가 폼 / 검색·오늘 필터 / 태그 칩 / 할 일 목록 |

- 화면 흐름: 로그인 안 됨 → `login.html`로 리다이렉트 → 로그인 성공 → 메인(`index.html`)
- 상호작용: 입력 폼 제출 → 목록 즉시 반영, 검색어 입력 → 실시간 필터, 체크박스 → 완료 토글

---

## 6. 데이터 구조 (Data Model)

SQLite (`node:sqlite`). 테이블 4개:

```
users
  id            INTEGER PK
  username      TEXT UNIQUE
  password_hash TEXT           -- scrypt(솔트 포함)
  created_at    TEXT

sessions
  token      TEXT PK           -- 랜덤 세션 토큰(쿠키 sid)
  user_id    INTEGER FK→users
  expires_at TEXT              -- 30일 만료

todos
  id         INTEGER PK
  title      TEXT
  is_done    INTEGER (0/1)
  due_date   TEXT (YYYY-MM-DD, nullable)
  created_at TEXT
  user_id    INTEGER FK→users  -- 사용자별 분리

tags
  id   INTEGER PK
  name TEXT UNIQUE

todo_tags (N:M 연결)
  todo_id FK→todos
  tag_id  FK→tags
```

---

## 7. API 명세 (Endpoints)

| 메서드 | 경로 | 인증 | 기능 |
|--------|------|------|------|
| POST | `/api/auth/signup` | - | 회원가입 |
| POST | `/api/auth/login` | - | 로그인 |
| POST | `/api/auth/logout` | - | 로그아웃 |
| GET | `/api/auth/me` | 쿠키 | 현재 사용자 |
| GET | `/api/todos` | ✔ | 목록 (검색·태그·오늘 필터) |
| POST | `/api/todos` | ✔ | 추가 |
| PATCH | `/api/todos/:id` | ✔ | 완료 토글 |
| DELETE | `/api/todos/:id` | ✔ | 삭제 |
| GET | `/api/tags` | ✔ | 태그 목록 |

---

## 8. 기술 스택 (Tech Stack)

- **프론트엔드**: HTML + CSS + 순수 JavaScript (프레임워크 없음)
- **백엔드**: Node.js + Express
- **DB**: SQLite (Node 내장 `node:sqlite`)
- **인증**: scrypt 해시 + 세션 쿠키 (외부 의존성 없음)
- **AI 연동**: MCP(Model Context Protocol) 서버 + Claude Code Skill
- **배포**: Cloudflare 터널 (로컬 SQLite 유지, 공개 HTTPS URL)

---

## 9. 향후 개선 (Future)

- 고정 도메인 배포(Fly.io + 볼륨 / Turso 등)로 24시간 운영
- 반응형 개선, 다크 모드
- 마감일 알림(푸시/카톡 자동 발송)
