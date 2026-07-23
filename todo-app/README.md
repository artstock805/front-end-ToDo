# Todo 앱 (MCP · Skill 연동)

로컬 SQLite 기반 할 일 관리 앱입니다. 웹 UI에 더해, **Claude에게 말로 할 일을 관리**할 수 있는
MCP 서버와 Skill을 갖췄습니다.

## 구성

```
todo-app/
├─ server.js        # Express 웹서버 (REST API + 인증 + 정적 파일)
├─ db.js            # node:sqlite DB 연결 + 스키마 (users·sessions·todos)
├─ auth.js          # ⭐ 인증 모듈 (scrypt 비밀번호 해시 + 세션 쿠키)
├─ mcp-server.js    # MCP 서버 (stdio) — Claude가 DB를 직접 조작
├─ kakao.js         # 카카오톡 전송 (선택)
├─ .mcp.json        # 프로젝트용 MCP 등록 설정
├─ public/          # 프론트엔드 (순수 JS) — index.html, login.html
└─ data/todo.db     # SQLite 데이터 (git 미포함)
```

## 인터넷에 공개하기 (다른 사람과 공유)

`localhost`는 자기 PC만 가리키므로, 다른 사람이 접속하려면 **공개 URL**이 필요합니다.
데이터(SQLite)는 내 PC에 그대로 두고 공개 주소만 여는 **Cloudflare 터널** 방식을 씁니다.

1. (최초 1회) cloudflared 설치:
   ```bash
   winget install --id Cloudflare.cloudflared
   ```
2. 실행: 프로젝트의 `start-public.cmd` (또는 바탕화면 "인터넷 공개.cmd") 더블클릭
3. 잠시 뒤 뜨는 `https://....trycloudflare.com` 주소를 상대에게 공유

동작 원리 / 주의:
- 서버는 `0.0.0.0`으로 수신하고, `app.set('trust proxy', true)` + HTTPS일 때 `Secure` 쿠키로
  터널(HTTPS) 뒤에서도 로그인이 정상 동작합니다. (로컬 http 접속에는 Secure를 붙이지 않음)
- **내 PC가 켜져 있고 서버·터널이 실행 중일 때만** 접속됩니다.
- quick 터널 주소는 실행할 때마다 **바뀝니다**. 고정 주소가 필요하면 Cloudflare 계정으로
  named tunnel을 설정하거나, 항상 켜두려면 별도 호스팅이 필요합니다.
- 공개 주소를 아는 누구나 **회원가입**할 수 있습니다(각자 자기 할 일만 봄). 아무에게나
  주소를 뿌리지 마세요.

## 로그인 (회원가입 · 다중 사용자)

- 첫 화면은 **로그인/회원가입**(`login.html`). 로그인해야 할 일 화면으로 들어갑니다.
- 각 사용자는 **자기 할 일만** 조회·수정 가능 (서버에서 `user_id`로 분리).
- 비밀번호는 Node 내장 `crypto.scrypt`로 **솔트 포함 해시** 저장 (평문 저장 안 함, 외부 의존성 없음).
- 세션은 httpOnly 쿠키(`sid`) + `sessions` 테이블(30일 만료).
- **처음 가입한 계정**에는 로그인 도입 이전의 기존 할 일이 자동으로 이전됩니다.

인증 API: `POST /api/auth/signup` · `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me`

## 1) 웹 앱 실행

```bash
npm install
npm start
```

브라우저에서 http://localhost:3456 접속. (포트는 `.env`의 `PORT`)

## 2) Claude 연동 (MCP + Skill)

### MCP 서버
`mcp-server.js`는 **웹서버와 같은 SQLite DB에 직접 연결**됩니다.
따라서 웹서버가 꺼져 있어도 Claude에서 할 일을 관리할 수 있고, 여기서 바꾼 내용은
브라우저 앱에도 그대로 반영됩니다.

> 로그인 도입 후, MCP는 **첫 번째(대표) 사용자**의 할 일을 다룹니다.
> 다른 계정을 쓰려면 `.env`에 `TODO_MCP_USER=아이디`를 지정하세요.

제공 도구:

| 도구 | 용도 |
|------|------|
| `list_todos` | 목록 조회 (검색어·태그·오늘 필터) |
| `add_todo` | 추가 (제목·마감일·태그) |
| `complete_todo` | 완료/미완료 토글 |
| `delete_todo` | 삭제 (고아 태그 자동 정리) |
| `list_tags` | 태그 목록 |
| `send_kakao` | 카카오톡 "나에게 보내기" (브리핑 요약 전송용) |

### Claude Code에 등록
프로젝트 루트의 `.mcp.json`이 자동 인식됩니다. (Claude Code를 이 폴더에서 실행할 경우)
전역에서 쓰려면 사용자 설정(`~/.claude.json`)의 `mcpServers`에 아래를 추가:

```json
{
  "mcpServers": {
    "todo-app": {
      "command": "node",
      "args": ["C:/Users/ssei8/todo-app/mcp-server.js"]
    }
  }
}
```

> 등록 후 Claude Code를 **재시작**해야 도구가 로드됩니다.

### Skill
Claude에게 도구를 **언제·어떻게 쓸지** 안내하는 스킬 2종 (`~/.claude/skills/`, 레포 `skill/`에도 복사):

- **`todo`** — 할 일 관리. (예: "내일까지 보고서 써야 해" → 마감일 변환해 `add_todo`)
- **`daily-briefing`** — 일일 브리핑. **날씨 → 환율·경제(임계값 알림) → 주요 뉴스 → 오늘 할 일**
  순으로 정리하고, 원하면 카카오톡으로 요약 전송.
  - 날씨 지역·환율 알림 기준은 `skill/daily-briefing/SKILL.md`의 "⚙️ 설정"에서 변경.

## 카카오톡 설정 (선택 — 브리핑을 카톡으로 받기)

카카오 "나에게 보내기"는 **1회 설정**이 필요합니다. 카카오 개발자 콘솔 작업은 본인 계정으로 직접 하세요.

1. https://developers.kakao.com → 로그인 → **애플리케이션 추가하기**
2. **앱 키**에서 **REST API 키** 복사 → `.env`의 `KAKAO_REST_API_KEY=`에 붙여넣기
3. **카카오 로그인** 메뉴 → **활성화 ON**
4. 카카오 로그인 → **Redirect URI**에 `http://localhost:3457/oauth` 등록
5. 카카오 로그인 → **동의항목** → **"카카오톡 메시지 전송"** 사용 설정
6. 터미널에서 실행:
   ```bash
   node get-kakao-token.js
   ```
   → 브라우저에서 "동의하고 계속하기" → `KAKAO_REFRESH_TOKEN`이 `.env`에 자동 저장됨

이후 Claude에게 **"브리핑 카톡으로 보내줘"**라고 하면 `send_kakao`로 요약이 전송됩니다.
(카카오 텍스트 메시지는 200자 제한이라 요약본이 전송되고, 전체 브리핑은 채팅에 표시됩니다.)

## 사용 예 (Claude에게)

- "장보기 할 일 추가해줘, 마감 이번 주 토요일" → 추가
- "오늘 뭐 해야 해?" → 오늘 마감 목록
- "학교 관련 할 일 보여줘" → 태그 필터
- "보고서 다 썼어" → 해당 항목 완료 처리
