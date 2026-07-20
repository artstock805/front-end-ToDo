import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3456;

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

// 목록 조회: ?q=검색어 &tag=태그명 &filter=today
app.get('/api/todos', (req, res) => {
  const { q, tag, filter } = req.query;
  const where = [];
  const params = [];

  if (q) {
    where.push(`todos.title LIKE ?`);
    params.push(`%${q}%`);
  }
  if (tag) {
    where.push(
      `todos.id IN (SELECT todo_id FROM todo_tags tt JOIN tags t ON t.id = tt.tag_id WHERE t.name = ?)`
    );
    params.push(tag);
  }
  if (filter === 'today') {
    where.push(`todos.due_date = date('now', 'localtime')`);
  }

  const sql = `
    SELECT id, title, is_done, due_date, created_at FROM todos
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
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

  const info = db
    .prepare(`INSERT INTO todos (title, due_date) VALUES (?, ?)`)
    .run(title.trim(), due_date || null);
  const todoId = info.lastInsertRowid;

  if (Array.isArray(tags)) {
    const upsertTag = db.prepare(
      `INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO UPDATE SET name = name RETURNING id`
    );
    const link = db.prepare(
      `INSERT OR IGNORE INTO todo_tags (todo_id, tag_id) VALUES (?, ?)`
    );
    for (const raw of tags) {
      const name = String(raw).trim();
      if (!name) continue;
      const { id: tagId } = upsertTag.get(name);
      link.run(todoId, tagId);
    }
  }

  const todo = db
    .prepare(`SELECT id, title, is_done, due_date, created_at FROM todos WHERE id = ?`)
    .get(todoId);
  res.status(201).json(attachTags([todo])[0]);
});

// 완료 토글: { is_done: 0 | 1 }
app.patch('/api/todos/:id', (req, res) => {
  const { is_done } = req.body;
  const info = db
    .prepare(`UPDATE todos SET is_done = ? WHERE id = ?`)
    .run(is_done ? 1 : 0, req.params.id);
  if (info.changes === 0) {
    return res.status(404).json({ error: '해당 할 일이 없습니다.' });
  }
  res.json({ ok: true });
});

// 삭제 (연결된 태그 링크는 CASCADE로 함께 삭제)
app.delete('/api/todos/:id', (req, res) => {
  const info = db.prepare(`DELETE FROM todos WHERE id = ?`).run(req.params.id);
  if (info.changes === 0) {
    return res.status(404).json({ error: '해당 할 일이 없습니다.' });
  }
  db.prepare(
    `DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM todo_tags)`
  ).run();
  res.json({ ok: true });
});

// 태그 목록 (필터 칩용)
app.get('/api/tags', (req, res) => {
  const rows = db
    .prepare(
      `SELECT t.name, COUNT(tt.todo_id) AS count
       FROM tags t LEFT JOIN todo_tags tt ON tt.tag_id = t.id
       GROUP BY t.id HAVING count > 0 ORDER BY t.name`
    )
    .all();
  res.json(rows);
});

app.listen(PORT, () => {
  console.log(`Todo 앱 실행 중: http://localhost:${PORT}`);
});
