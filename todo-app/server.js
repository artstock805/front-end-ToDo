import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from './db.js';
import {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  getSessionUser,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  COOKIE_NAME,
} from './auth.js';
import { aiEnabled, parseTodo, summarizeTodos } from './ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3456;
const HOST = process.env.HOST || '0.0.0.0'; // 모든 인터페이스에서 수신 (터널/LAN 접속 허용)

// 터널·리버스프록시(Cloudflare 등) 뒤에서 실제 프로토콜(https)을 인식하게 함
app.set('trust proxy', true);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function attachTags(todos) {
  if (todos.length === 0) return todos;
  const placeholders = todos.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT tt.todo_id, t.name
       FROM todo_tags tt JOIN tags t ON t.id = tt.tag_id
       WHERE tt.todo_id IN (${placeholders})
       ORDER BY t.name`
    )
    .all(...todos.map((t) => t.id));
  const byTodo = new Map();
  for (const r of rows) {
    if (!byTodo.has(r.todo_id)) byTodo.set(r.todo_id, []);
    byTodo.get(r.todo_id).push(r.name);
  }
  return todos.map((t) => ({ ...t, tags: byTodo.get(t.id) || [] }));
}

/** 할 일 한 건 생성 (태그 upsert 포함) 후 tags 붙은 객체 반환 */
function insertTodo(userId, title, due_date, tags) {
  const info = db
    .prepare('INSERT INTO todos (title, due_date, user_id) VALUES (?, ?, ?)')
    .run(title, due_date || null, userId);
  const todoId = info.lastInsertRowid;

  if (Array.isArray(tags)) {
    const upsertTag = db.prepare(
      'INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO UPDATE SET name = name RETURNING id'
    );
    const link = db.prepare('INSERT OR IGNORE INTO todo_tags (todo_id, tag_id) VALUES (?, ?)');
    for (const raw of tags) {
      const name = String(raw).trim();
      if (!name) continue;
      const { id: tagId } = upsertTag.get(name);
      link.run(todoId, tagId);
    }
  }

  const todo = db
    .prepare('SELECT id, title, is_done, due_date, created_at FROM todos WHERE id = ?')
    .get(todoId);
  return attachTags([todo])[0];
}

/** 오늘 날짜 (로컬 기준, YYYY-MM-DD) */
function todayStr() {
  return db.prepare("SELECT date('now', 'localtime') AS d").get().d;
}

// ══ 인증 라우트 ═══════════════════════════════════════════════
const USERNAME_RE = /^[a-zA-Z0-9_가-힣]{2,20}$/;
const PASSWORD_RE = /^[a-zA-Z0-9]{4,}$/; // 영문·숫자만, 4자 이상

// 회원가입
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !USERNAME_RE.test(username)) {
      return res.status(400).json({ error: '아이디는 2~20자(한글/영문/숫자/_)로 입력해주세요.' });
    }
    if (!password || !PASSWORD_RE.test(password)) {
      return res.status(400).json({ error: '비밀번호는 영문·숫자만 사용해 4자 이상으로 입력해주세요.' });
    }
    const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (exists) return res.status(409).json({ error: '이미 사용 중인 아이디입니다.' });

    const isFirstUser = !db.prepare('SELECT id FROM users LIMIT 1').get();
    const hash = await hashPassword(password);
    const info = db
      .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
      .run(username, hash);
    const userId = info.lastInsertRowid;

    // 첫 가입 계정에 기존(로그인 이전) 할 일을 이전
    let migrated = 0;
    if (isFirstUser) {
      migrated = db.prepare('UPDATE todos SET user_id = ? WHERE user_id IS NULL').run(userId).changes;
    }

    const token = createSession(userId);
    setSessionCookie(req, res, token);
    res.status(201).json({ username, migrated });
  } catch (e) {
    res.status(500).json({ error: '회원가입 처리 중 오류가 발생했습니다.' });
  }
});

// 로그인
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = db
      .prepare('SELECT id, username, password_hash FROM users WHERE username = ?')
      .get(username || '');
    if (!user || !(await verifyPassword(password || '', user.password_hash))) {
      return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    }
    const token = createSession(user.id);
    setSessionCookie(req, res, token);
    res.json({ username: user.username });
  } catch (e) {
    res.status(500).json({ error: '로그인 처리 중 오류가 발생했습니다.' });
  }
});

// 로그아웃
app.post('/api/auth/logout', (req, res) => {
  const token = parseCookies(req)[COOKIE_NAME];
  destroySession(token);
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

// 현재 로그인 사용자
app.get('/api/auth/me', (req, res) => {
  const user = getSessionUser(parseCookies(req)[COOKIE_NAME]);
  if (!user) return res.status(401).json({ error: '로그인이 필요합니다.' });
  res.json({ username: user.username });
});

// ══ 할 일 라우트 (로그인 필요, 사용자별 분리) ════════════════════
app.use('/api/todos', requireAuth);
app.use('/api/tags', requireAuth);

// 목록 조회: ?q=검색어 &tag=태그명 &filter=today
app.get('/api/todos', (req, res) => {
  const { q, tag, filter } = req.query;
  const where = ['todos.user_id = ?'];
  const params = [req.userId];

  if (q) {
    where.push('todos.title LIKE ?');
    params.push(`%${q}%`);
  }
  if (tag) {
    where.push(
      'todos.id IN (SELECT todo_id FROM todo_tags tt JOIN tags t ON t.id = tt.tag_id WHERE t.name = ?)'
    );
    params.push(tag);
  }
  if (filter === 'today') {
    where.push("todos.due_date = date('now', 'localtime')");
  }

  const sql = `
    SELECT id, title, is_done, due_date, created_at FROM todos
    WHERE ${where.join(' AND ')}
    ORDER BY is_done ASC,
             CASE WHEN due_date IS NULL THEN 1 ELSE 0 END,
             due_date ASC, id DESC`;
  const todos = db.prepare(sql).all(...params);
  res.json(attachTags(todos));
});

// 추가: { title, due_date?, tags?: ["이름", ...] }
app.post('/api/todos', (req, res) => {
  const { title, due_date, tags } = req.body;
  if (!title || !title.trim()) {
    return res.status(400).json({ error: '제목을 입력해주세요.' });
  }
  if (due_date && !/^\d{4}-\d{2}-\d{2}$/.test(due_date)) {
    return res.status(400).json({ error: '마감일 형식이 올바르지 않습니다.' });
  }
  res.status(201).json(insertTodo(req.userId, title.trim(), due_date, tags));
});

// 완료 토글: { is_done: 0 | 1 } — 본인 소유만
app.patch('/api/todos/:id', (req, res) => {
  const { is_done } = req.body;
  const info = db
    .prepare('UPDATE todos SET is_done = ? WHERE id = ? AND user_id = ?')
    .run(is_done ? 1 : 0, req.params.id, req.userId);
  if (info.changes === 0) {
    return res.status(404).json({ error: '해당 할 일이 없습니다.' });
  }
  res.json({ ok: true });
});

// 삭제 — 본인 소유만 (연결된 태그 링크는 CASCADE, 고아 태그 정리)
app.delete('/api/todos/:id', (req, res) => {
  const info = db
    .prepare('DELETE FROM todos WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.userId);
  if (info.changes === 0) {
    return res.status(404).json({ error: '해당 할 일이 없습니다.' });
  }
  db.prepare('DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM todo_tags)').run();
  res.json({ ok: true });
});

// 태그 목록 (필터 칩용) — 본인 할 일에 쓰인 태그만
app.get('/api/tags', (req, res) => {
  const rows = db
    .prepare(
      `SELECT t.name, COUNT(tt.todo_id) AS count
       FROM tags t
       JOIN todo_tags tt ON tt.tag_id = t.id
       JOIN todos td ON td.id = tt.todo_id
       WHERE td.user_id = ?
       GROUP BY t.id HAVING count > 0 ORDER BY t.name`
    )
    .all(req.userId);
  res.json(rows);
});

// ══ AI 기능 (Claude API) ═══════════════════════════════════════
// AI 활성화 여부 (프론트가 버튼 표시 결정)
app.get('/api/ai/status', (req, res) => {
  res.json({ enabled: aiEnabled() });
});

// 자연어 → 할 일 자동 추가
app.post('/api/ai/add-todo', requireAuth, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: '내용을 입력해주세요.' });
    }
    const parsed = await parseTodo(text.trim(), todayStr());
    if (!parsed.title) {
      return res.status(422).json({ error: 'AI가 할 일을 이해하지 못했어요. 다시 입력해보세요.' });
    }
    res.status(201).json(insertTodo(req.userId, parsed.title, parsed.due_date, parsed.tags));
  } catch (e) {
    res.status(500).json({ error: 'AI 처리 실패: ' + e.message });
  }
});

// 할 일 우선순위 AI 정리
app.post('/api/ai/summary', requireAuth, async (req, res) => {
  try {
    const todos = attachTags(
      db
        .prepare(
          `SELECT id, title, is_done, due_date, created_at FROM todos
           WHERE user_id = ?
           ORDER BY is_done ASC,
                    CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date ASC, id DESC`
        )
        .all(req.userId)
    );
    const pending = todos.filter((t) => !t.is_done);
    if (pending.length === 0) {
      return res.json({ summary: '미완료 할 일이 없어요! 🎉 새 할 일을 추가하거나 좀 쉬어도 좋아요.' });
    }
    const summary = await summarizeTodos(todos, todayStr());
    res.json({ summary });
  } catch (e) {
    res.status(500).json({ error: 'AI 처리 실패: ' + e.message });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Todo 앱 실행 중`);
  console.log(`  - 내 PC:  http://localhost:${PORT}`);
  console.log(`  - 같은 WiFi: http://<내부IP>:${PORT}  (ipconfig로 IPv4 확인)`);
  console.log(`  - 인터넷 공개: start-public.cmd 로 Cloudflare 터널 실행`);
});
