/**
 * 카카오톡 "나에게 보내기" (나와의 채팅) 전송 모듈
 * - refresh_token으로 access_token을 갱신한 뒤 memo/default/send API 호출.
 * - 카카오가 새 refresh_token을 내려주면 .env에 자동 갱신 저장.
 * - 필요한 .env 값: KAKAO_REST_API_KEY, KAKAO_REFRESH_TOKEN
 *   (발급은 get-kakao-token.js를 한 번 실행하면 자동으로 채워집니다.)
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '.env');

const TOKEN_URL = 'https://kauth.kakao.com/oauth/token';
const SEND_URL = 'https://kapi.kakao.com/v2/api/talk/memo/default/send';
const KAKAO_TEXT_MAX = 200; // 기본 텍스트 템플릿 최대 길이

/** .env의 특정 키 값을 갱신(없으면 추가) */
function updateEnv(key, value) {
  let txt = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  txt = re.test(txt) ? txt.replace(re, line) : `${txt.trimEnd()}\n${line}\n`;
  fs.writeFileSync(ENV_PATH, txt);
}

/** refresh_token으로 access_token 발급 (새 refresh_token 오면 저장) */
export async function getAccessToken() {
  const clientId = process.env.KAKAO_REST_API_KEY;
  const refreshToken = process.env.KAKAO_REFRESH_TOKEN;
  if (!clientId || !refreshToken) {
    throw new Error(
      'KAKAO_REST_API_KEY 또는 KAKAO_REFRESH_TOKEN이 .env에 없습니다. `node get-kakao-token.js`를 먼저 실행하세요.'
    );
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: refreshToken,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error('토큰 갱신 실패: ' + JSON.stringify(data));
  if (data.refresh_token) {
    updateEnv('KAKAO_REFRESH_TOKEN', data.refresh_token);
    process.env.KAKAO_REFRESH_TOKEN = data.refresh_token;
  }
  return data.access_token;
}

/**
 * 나에게 카카오톡 메시지 전송
 * @param {string} text 보낼 내용 (200자 초과 시 잘림)
 * @param {string} [linkUrl] 메시지에 붙일 링크 (버튼/텍스트 클릭 시 이동)
 */
export async function sendToMe(text, linkUrl = 'http://localhost:3456') {
  const accessToken = await getAccessToken();
  let body = String(text || '').trim();
  if (!body) throw new Error('보낼 내용이 비어 있습니다.');
  if (body.length > KAKAO_TEXT_MAX) body = body.slice(0, KAKAO_TEXT_MAX - 1) + '…';

  const templateObject = {
    object_type: 'text',
    text: body,
    link: { web_url: linkUrl, mobile_web_url: linkUrl },
    button_title: '할 일 앱 열기',
  };

  const res = await fetch(SEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
    },
    body: new URLSearchParams({ template_object: JSON.stringify(templateObject) }),
  });
  const data = await res.json();
  if (!res.ok || data.result_code !== 0) {
    throw new Error('카카오 전송 실패: ' + JSON.stringify(data));
  }
  return true;
}
