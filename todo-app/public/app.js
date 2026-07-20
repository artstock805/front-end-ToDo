const state = { q: '', tag: '', today: false };

const $ = (sel) => document.querySelector(sel);
const listEl = $('#todo-list');
const emptyEl = $('#empty-msg');
const chipsEl = $('#tag-chips');
const todayBtn = $('#today-btn');

const todayStr = () => {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
};

function googleCalendarUrl(todo) {
  const start = todo.due_date.replaceAll('-', '');
  const endDate = new Date(todo.due_date + 'T00:00:00');
  endDate.setDate(endDate.getDate() + 1);
  const end = [
    endDate.getFullYear(),
    String(endDate.getMonth() + 1).padStart(2, '0'),
    String(endDate.getDate()).padStart(2, '0'),
  ].join('');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: todo.title,
    dates: `${start}/${end}`,
  });
  if (todo.tags.length > 0) {
    params.set('details', '태그: ' + todo.tags.map((t) => `#${t}`).join(' '));
  }
  return `https://calendar.google.com/calendar/render?${params}`;
}

async function api(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || '요청에 실패했습니다.');
  }
  return res.json();
}

async function loadTodos() {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.tag) params.set('tag', state.tag);
  if (state.today) params.set('filter', 'today');
  const todos = await api(`/api/todos?${params}`);
  renderTodos(todos);
}

async function loadTags() {
  const tags = await api('/api/tags');
  chipsEl.innerHTML = '';
  for (const t of tags) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip' + (state.tag === t.name ? ' active' : '');
    btn.textContent = `#${t.name} (${t.count})`;
    btn.onclick = () => {
      state.tag = state.tag === t.name ? '' : t.name;
      refresh();
    };
    chipsEl.appendChild(btn);
  }
}

function renderTodos(todos) {
  listEl.innerHTML = '';
  emptyEl.hidden = todos.length > 0;
  const today = todayStr();

  for (const todo of todos) {
    const li = document.createElement('li');
    li.className = 'todo-item' + (todo.is_done ? ' done' : '');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !!todo.is_done;
    checkbox.onchange = async () => {
      await api(`/api/todos/${todo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_done: checkbox.checked ? 1 : 0 }),
      });
      refresh();
    };

    const body = document.createElement('div');
    body.className = 'todo-body';

    const title = document.createElement('div');
    title.className = 'todo-title';
    title.textContent = todo.title;
    body.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'todo-meta';

    if (todo.due_date) {
      const badge = document.createElement('span');
      badge.className = 'due-badge';
      if (!todo.is_done && todo.due_date < today) {
        badge.classList.add('overdue');
        badge.textContent = `⚠ ${todo.due_date} (지남)`;
      } else if (todo.due_date === today) {
        badge.classList.add('today');
        badge.textContent = `오늘 (${todo.due_date})`;
      } else {
        badge.textContent = todo.due_date;
      }
      meta.appendChild(badge);
    }

    if (todo.due_date) {
      const cal = document.createElement('a');
      cal.className = 'cal-btn';
      cal.textContent = '📅 캘린더';
      cal.title = '구글 캘린더에 추가';
      cal.target = '_blank';
      cal.rel = 'noopener';
      cal.href = googleCalendarUrl(todo);
      meta.appendChild(cal);
    }

    for (const tag of todo.tags) {
      const badge = document.createElement('span');
      badge.className = 'tag-badge';
      badge.textContent = `#${tag}`;
      badge.onclick = () => {
        state.tag = state.tag === tag ? '' : tag;
        refresh();
      };
      meta.appendChild(badge);
    }

    if (meta.children.length > 0) body.appendChild(meta);

    const delBtn = document.createElement('button');
    delBtn.className = 'delete-btn';
    delBtn.textContent = '✕';
    delBtn.title = '삭제';
    delBtn.onclick = async () => {
      if (!confirm(`"${todo.title}" 항목을 삭제할까요?`)) return;
      await api(`/api/todos/${todo.id}`, { method: 'DELETE' });
      refresh();
    };

    li.append(checkbox, body, delBtn);
    listEl.appendChild(li);
  }
}

function refresh() {
  todayBtn.classList.toggle('active', state.today);
  loadTodos().catch((e) => alert(e.message));
  loadTags().catch(() => {});
}

$('#add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = $('#title-input').value.trim();
  if (!title) return;
  const due_date = $('#due-input').value || null;
  const tags = $('#tags-input').value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  try {
    await api('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, due_date, tags }),
    });
    e.target.reset();
    refresh();
  } catch (err) {
    alert(err.message);
  }
});

let searchTimer;
$('#search-input').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.q = e.target.value.trim();
    refresh();
  }, 250);
});

todayBtn.addEventListener('click', () => {
  state.today = !state.today;
  refresh();
});

refresh();
