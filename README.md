# 나의 할 일 (Todo App)

로컬 SQLite에 저장되는 할 일 관리 앱입니다. 서버를 껐다 켜도 데이터가 유지됩니다.

## 기능

- 할 일 추가 / 목록 보기 / 완료 표시 / 삭제 (기본 CRUD)
- **마감일** — 지난 항목은 빨간 경고, 오늘 항목은 노란 배지로 표시
- **태그** — 쉼표로 여러 개 입력, 태그 칩 클릭으로 필터링
- **검색** — 제목 실시간 검색
- 오늘 할 일만 보기 필터
- 구글 캘린더에 추가 버튼 (마감일 있는 항목)

## 기술 스택

| 구분 | 사용 기술 |
|---|---|
| 백엔드 | Node.js + Express |
| DB | SQLite (Node.js 22+ 내장 `node:sqlite` — 별도 설치 불필요) |
| 프론트엔드 | HTML / CSS / 순수 JavaScript (프레임워크 없음) |
| 설정 | dotenv (`.env`) |

전부 무료 도구이며, 비밀값·로컬 설정은 `.env`로 분리되어 있습니다 (저장소에는 `.env.example`만 포함).

## 실행 방법

Node.js 22 이상이 필요합니다.

```bash
cd todo-app
npm install
cp .env.example .env   # Windows: copy .env.example .env
npm start
```

브라우저에서 http://localhost:3456 접속.

## DB 구조

데이터는 `data/todo.db` 파일 하나에 저장되며, 서버 첫 실행 시 테이블이 자동 생성됩니다.

```
todos (할 일)          tags (태그)          todo_tags (연결)
├─ id (PK)            ├─ id (PK)           ├─ todo_id (PK, FK → todos.id)
├─ title              └─ name (UNIQUE)     └─ tag_id  (PK, FK → tags.id)
├─ is_done (0/1)
├─ due_date (nullable)
└─ created_at
```

- 할 일 ↔ 태그는 다대다(N:M) 관계로, `todo_tags` 연결 표로 해소
- 할 일 삭제 시 연결 기록은 `ON DELETE CASCADE`로 자동 삭제
- `due_date`에 인덱스 적용 (마감일 필터/정렬용)

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/todos?q=&tag=&filter=today` | 목록 (검색·태그·오늘 필터) |
| POST | `/api/todos` | 추가 `{ title, due_date?, tags? }` |
| PATCH | `/api/todos/:id` | 완료 토글 `{ is_done }` |
| DELETE | `/api/todos/:id` | 삭제 |
| GET | `/api/tags` | 사용 중인 태그 목록 |
