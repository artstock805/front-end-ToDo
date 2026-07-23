#!/usr/bin/env node
/**
 * Todo 앱 MCP 서버 (stdio)
 * - SQLite DB(todo.db)에 직접 연결해 할 일을 관리합니다.
 * - 웹서버(server.js)가 꺼져 있어도 독립적으로 동작합니다.
 * - 웹 앱과 같은 DB 파일을 공유하므로, 여기서 추가한 할 일은 브라우저에서도 바로 보입니다.
 */
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { sendToMe } from './kakao.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// DB 경로를 이 파일 기준 절대경로로 고정한다.
// Claude Code가 임의의 작업 디렉터리에서 서버를 실행해도 항상 같은 todo.db를 바라보게 하기 위함.
if (!process.env.DB_PATH || !path.isAbsolute(process.env.DB_PATH)) {
  process.env.DB_PATH = path.join(__dirname, process.env.DB_PATH || './data/todo.db');
}

// env(DB_PATH)를 확정한 뒤에 db.js를 불러와야 하므로 동적 import 사용.
const { default: db } = await import('./db.js');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 할 일 배열에 tags 필드를 붙여 반환 (server.js와 동일한 로직) */
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

/** 할 일 한 건을 사람이 읽기 좋은 한 줄로 포맷 */
function formatTodo(t) {
  const check = t.is_done ? '✅' : '⬜';
  const due = t.due_date ? ` (마감: ${t.due_date})` : '';
  const tags = t.tags && t.tags.length ? ` [${t.tags.join(', ')}]` : '';
  return `${check} #${t.id} ${t.title}${due}${tags}`;
}

function textResult(text) {
  return { content: [{ type: 'text', text }] };
}

/**
 * MCP가 다룰 "소유자" 사용자 id를 결정한다.
 * - env TODO_MCP_USER(아이디)가 있으면 그 사용자, 없으면 첫 번째(가장 먼저 가입한) 사용자.
 * - 아직 가입한 사용자가 없으면 null (로그인 이전의 user_id IS NULL 데이터를 가리킴).
 * SQL에서는 `user_id IS ?` 로 바인딩하면 값이 null이든 정수든 올바르게 매칭된다.
 * 사용자가 실행 중에 가입할 수 있으므로 매 호출마다 다시 계산한다.
 */
function ownerUserId() {
  const name = process.env.TODO_MCP_USER;
  if (name) {
    const u = db.prepare('SELECT id FROM users WHERE username = ?').get(name);
    if (u) return u.id;
  }
  const first = db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get();
  return first ? first.id : null;
}

const server = new McpServer({ name: 'todo-app', version: '1.0.0' });

// ── 목록 조회 ──────────────────────────────────────────────
server.registerTool(
  'list_todos',
  {
    title: '할 일 목록 조회',
    description:
      '할 일 목록을 조회합니다. 검색어(q), 태그 이름(tag), 오늘 마감 필터(today)로 좁힐 수 있습니다. 아무 조건 없이 호출하면 전체 목록을 반환합니다.',
    inputSchema: {
      q: z.string().optional().describe('제목에 포함된 검색어'),
      tag: z.string().optional().describe('이 태그가 붙은 할 일만'),
      today: z.boolean().optional().describe('true면 오늘(로컬 기준) 마감인 할 일만'),
    },
  },
  async ({ q, tag, today }) => {
    const where = ['todos.user_id IS ?'];
    const params = [ownerUserId()];
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
    if (today) {
      where.push("todos.due_date = date('now', 'localtime')");
    }
    const sql = `
      SELECT id, title, is_done, due_date, created_at FROM todos
      WHERE ${where.join(' AND ')}
      ORDER BY is_done ASC,
               CASE WHEN due_date IS NULL THEN 1 ELSE 0 END,
               due_date ASC, id DESC`;
    const todos = attachTags(db.prepare(sql).all(...params));
    if (todos.length === 0) return textResult('조건에 맞는 할 일이 없습니다.');
    const lines = todos.map(formatTodo).join('\n');
    return textResult(`할 일 ${todos.length}건:\n${lines}`);
  }
);

// ── 추가 ──────────────────────────────────────────────────
server.registerTool(
  'add_todo',
  {
    title: '할 일 추가',
    description:
      '새 할 일을 추가합니다. title은 필수입니다. 마감일(due_date)은 YYYY-MM-DD 형식이며, tags는 문자열 배열로 여러 개 붙일 수 있습니다.',
    inputSchema: {
      title: z.string().min(1).describe('할 일 제목 (필수)'),
      due_date: z
        .string()
        .regex(DATE_RE, 'YYYY-MM-DD 형식이어야 합니다')
        .optional()
        .describe('마감일 (YYYY-MM-DD)'),
      tags: z.array(z.string()).optional().describe('태그 이름 목록'),
    },
  },
  async ({ title, due_date, tags }) => {
    const clean = title.trim();
    if (!clean) return textResult('❌ 제목이 비어 있습니다.');

    const info = db
      .prepare('INSERT INTO todos (title, due_date, user_id) VALUES (?, ?, ?)')
      .run(clean, due_date || null, ownerUserId());
    const todoId = info.lastInsertRowid;

    if (Array.isArray(tags)) {
      const upsertTag = db.prepare(
        'INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO UPDATE SET name = name RETURNING id'
      );
      const link = db.prepare(
        'INSERT OR IGNORE INTO todo_tags (todo_id, tag_id) VALUES (?, ?)'
      );
      for (const raw of tags) {
        const name = String(raw).trim();
        if (!name) continue;
        const { id: tagId } = upsertTag.get(name);
        link.run(todoId, tagId);
      }
    }

    const todo = attachTags([
      db
        .prepare('SELECT id, title, is_done, due_date, created_at FROM todos WHERE id = ?')
        .get(todoId),
    ])[0];
    return textResult(`➕ 추가됨:\n${formatTodo(todo)}`);
  }
);

// ── 완료/미완료 토글 ────────────────────────────────────────
server.registerTool(
  'complete_todo',
  {
    title: '할 일 완료 처리',
    description:
      '할 일의 완료 상태를 바꿉니다. done을 생략하면 완료(true)로 처리하고, done=false로 다시 미완료로 되돌릴 수 있습니다.',
    inputSchema: {
      id: z.number().int().positive().describe('할 일 ID'),
      done: z.boolean().optional().describe('true=완료(기본), false=미완료로 되돌림'),
    },
  },
  async ({ id, done }) => {
    const isDone = done === false ? 0 : 1;
    const info = db
      .prepare('UPDATE todos SET is_done = ? WHERE id = ? AND user_id IS ?')
      .run(isDone, id, ownerUserId());
    if (info.changes === 0) return textResult(`❌ #${id} 할 일을 찾을 수 없습니다.`);
    const todo = attachTags([
      db
        .prepare('SELECT id, title, is_done, due_date, created_at FROM todos WHERE id = ?')
        .get(id),
    ])[0];
    return textResult(`${isDone ? '✅ 완료 처리됨' : '↩️ 미완료로 되돌림'}:\n${formatTodo(todo)}`);
  }
);

// ── 삭제 ──────────────────────────────────────────────────
server.registerTool(
  'delete_todo',
  {
    title: '할 일 삭제',
    description: '할 일을 삭제합니다. 어떤 태그에도 쓰이지 않게 된 태그는 함께 정리됩니다.',
    inputSchema: {
      id: z.number().int().positive().describe('삭제할 할 일 ID'),
    },
  },
  async ({ id }) => {
    const owner = ownerUserId();
    const todo = db
      .prepare('SELECT id, title FROM todos WHERE id = ? AND user_id IS ?')
      .get(id, owner);
    if (!todo) return textResult(`❌ #${id} 할 일을 찾을 수 없습니다.`);
    db.prepare('DELETE FROM todos WHERE id = ? AND user_id IS ?').run(id, owner);
    // 고아 태그 정리 (server.js와 동일)
    db.prepare(
      'DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM todo_tags)'
    ).run();
    return textResult(`🗑️ 삭제됨: #${todo.id} ${todo.title}`);
  }
);

// ── 태그 목록 ──────────────────────────────────────────────
server.registerTool(
  'list_tags',
  {
    title: '태그 목록 조회',
    description: '사용 중인 태그와 각 태그가 붙은 할 일 개수를 조회합니다.',
    inputSchema: {},
  },
  async () => {
    const rows = db
      .prepare(
        `SELECT t.name, COUNT(tt.todo_id) AS count
         FROM tags t
         JOIN todo_tags tt ON tt.tag_id = t.id
         JOIN todos td ON td.id = tt.todo_id
         WHERE td.user_id IS ?
         GROUP BY t.id HAVING count > 0 ORDER BY t.name`
      )
      .all(ownerUserId());
    if (rows.length === 0) return textResult('사용 중인 태그가 없습니다.');
    const lines = rows.map((r) => `#${r.name} (${r.count})`).join('\n');
    return textResult(`태그 ${rows.length}개:\n${lines}`);
  }
);

// ── 카카오톡 나에게 보내기 ──────────────────────────────────
server.registerTool(
  'send_kakao',
  {
    title: '카카오톡 나에게 보내기',
    description:
      '지정한 텍스트를 사용자의 카카오톡 "나와의 채팅"으로 보냅니다. 카카오 기본 텍스트 제한(200자) 때문에 짧은 요약이 적합합니다. .env에 KAKAO_REST_API_KEY와 KAKAO_REFRESH_TOKEN이 설정되어 있어야 합니다.',
    inputSchema: {
      text: z.string().min(1).describe('보낼 내용 (200자 이내 권장, 초과 시 잘림)'),
      link: z.string().url().optional().describe('메시지에 붙일 링크 (기본: 할 일 앱 주소)'),
    },
  },
  async ({ text, link }) => {
    try {
      await sendToMe(text, link);
      return textResult('✅ 카카오톡으로 전송했습니다.');
    } catch (e) {
      return textResult('❌ 카카오 전송 실패: ' + e.message);
    }
  }
);

// ── 서버 시작 ──────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
