/**
 * AI 기능 모듈 (Claude API)
 * - parseTodo: 자연어를 {title, due_date, tags}로 구조화 (구조화 출력)
 * - summarizeTodos: 할 일 목록을 보고 우선순위 조언
 * 비용이 저렴한 Haiku를 기본으로 사용 (ANTHROPIC_MODEL로 변경 가능).
 * ANTHROPIC_API_KEY가 없으면 aiEnabled()가 false → 서버가 기능을 숨김.
 */
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';

export function aiEnabled() {
  return !!process.env.ANTHROPIC_API_KEY;
}

function getClient() {
  if (!aiEnabled()) {
    throw new Error('AI 기능이 비활성화되어 있습니다 (.env에 ANTHROPIC_API_KEY 없음).');
  }
  return new Anthropic(); // ANTHROPIC_API_KEY 환경변수 사용
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 자연어 입력 → { title, due_date(YYYY-MM-DD|null), tags[] }
 * @param {string} text 사용자 입력
 * @param {string} today 오늘 날짜 (YYYY-MM-DD) — 상대 날짜 변환 기준
 */
export async function parseTodo(text, today) {
  const client = getClient();
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    system:
      `너는 한국어 할 일 관리 비서다. 사용자의 자연어 입력에서 할 일 하나를 추출한다.\n` +
      `- title: 핵심 할 일 제목을 간결하게 (군더더기 제거)\n` +
      `- due_date: 마감일이 있으면 YYYY-MM-DD, 없으면 null. 오늘은 ${today}. ` +
      `"오늘"=${today}, "내일"=+1일, "모레"=+2일, "이번 주 금요일" 등 상대 표현을 실제 날짜로 변환한다.\n` +
      `- tags: 맥락상 자연스러운 분류 태그 배열. 없으면 빈 배열. 억지로 만들지 말 것.`,
    output_config: {
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            due_date: { type: ['string', 'null'] },
            tags: { type: 'array', items: { type: 'string' } },
          },
          required: ['title', 'due_date', 'tags'],
          additionalProperties: false,
        },
      },
    },
    messages: [{ role: 'user', content: text }],
  });

  const out = res.content.find((b) => b.type === 'text')?.text || '{}';
  const parsed = JSON.parse(out);
  return {
    title: String(parsed.title || '').trim(),
    due_date: DATE_RE.test(parsed.due_date || '') ? parsed.due_date : null,
    tags: Array.isArray(parsed.tags) ? parsed.tags.map((t) => String(t).trim()).filter(Boolean) : [],
  };
}

/**
 * 할 일 목록 → 우선순위 조언 텍스트
 * @param {Array} todos {title, is_done, due_date, tags}
 * @param {string} today 오늘 날짜
 */
export async function summarizeTodos(todos, today) {
  const client = getClient();
  const list = todos
    .map((t) => {
      const state = t.is_done ? '완료' : '미완료';
      const due = t.due_date ? ` (마감 ${t.due_date})` : '';
      const tags = t.tags && t.tags.length ? ` #${t.tags.join(' #')}` : '';
      return `- [${state}] ${t.title}${due}${tags}`;
    })
    .join('\n');

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system:
      `너는 한국어 생산성 코치다. 오늘은 ${today}. 사용자의 할 일 목록을 보고 ` +
      `지금 무엇을 먼저 하면 좋을지 우선순위와 짧은 이유를 조언한다. ` +
      `마감이 지났거나 임박한 항목을 우선한다. 이미 완료된 항목은 제외한다. ` +
      `친근한 말투로 3~5줄, 불릿으로 간결하게.`,
    messages: [{ role: 'user', content: `내 할 일 목록:\n${list}\n\n지금 뭘 먼저 할지 조언해줘.` }],
  });

  return res.content.find((b) => b.type === 'text')?.text || '';
}
