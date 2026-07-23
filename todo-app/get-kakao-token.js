/**
 * 카카오 토큰 최초 발급 헬퍼 (1회만 실행)
 *
 * 사전 준비 (카카오 개발자 콘솔에서 본인이 직접):
 *   1) https://developers.kakao.com → 애플리케이션 추가
 *   2) [앱 키]의 REST API 키를 .env의 KAKAO_REST_API_KEY 에 넣기
 *   3) [카카오 로그인] 활성화 ON
 *   4) [카카오 로그인] > Redirect URI 에  http://localhost:3457/oauth  등록
 *   5) [카카오 로그인] > 동의항목 에서 "카카오톡 메시지 전송(talk_message)" 사용 설정
 *
 * 실행:  node get-kakao-token.js
 *   → 브라우저가 열리면 동의 → 자동으로 refresh_token 이 .env 에 저장됩니다.
 */
import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '.env');

const PORT = 3457;
const REDIRECT_URI = `http://localhost:${PORT}/oauth`;
const TOKEN_URL = 'https://kauth.kakao.com/oauth/token';
const AUTH_URL = 'https://kauth.kakao.com/oauth/authorize';

const clientId = process.env.KAKAO_REST_API_KEY;
if (!clientId) {
  console.error('❌ .env에 KAKAO_REST_API_KEY가 없습니다. 먼저 REST API 키를 넣어주세요.');
  process.exit(1);
}

function updateEnv(key, value) {
  let txt = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  txt = re.test(txt) ? txt.replace(re, line) : `${txt.trimEnd()}\n${line}\n`;
  fs.writeFileSync(ENV_PATH, txt);
}

const authorizeUrl =
  `${AUTH_URL}?response_type=code` +
  `&client_id=${encodeURIComponent(clientId)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&scope=talk_message`;

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith('/oauth')) {
    res.writeHead(404);
    res.end();
    return;
  }
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<h2>인증 실패: ${error}</h2><p>이 창을 닫고 다시 시도하세요.</p>`);
    console.error('❌ 인증 실패:', error);
    server.close();
    return;
  }

  try {
    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        code,
      }),
    });
    const data = await tokenRes.json();
    if (!tokenRes.ok || !data.refresh_token) {
      throw new Error(JSON.stringify(data));
    }
    updateEnv('KAKAO_REFRESH_TOKEN', data.refresh_token);

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h2>✅ 카카오 연동 완료!</h2><p>이 창을 닫으셔도 됩니다. 이제 브리핑을 카톡으로 받을 수 있어요.</p>');
    console.log('\n✅ refresh_token을 .env에 저장했습니다. 설정 완료!');
    console.log('   이제 Claude에게 "브리핑 카톡으로 보내줘" 라고 하면 됩니다.');
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h2>토큰 발급 실패</h2><pre>' + String(e.message) + '</pre>');
    console.error('❌ 토큰 발급 실패:', e.message);
  } finally {
    server.close();
  }
});

server.listen(PORT, () => {
  console.log('카카오 인증을 시작합니다. 브라우저가 열리면 "동의하고 계속하기"를 눌러주세요.');
  console.log('브라우저가 안 열리면 아래 주소를 직접 여세요:\n' + authorizeUrl + '\n');
  // Windows에서 기본 브라우저로 열기
  exec(`start "" "${authorizeUrl}"`, { shell: 'cmd.exe' }, (err) => {
    if (err) console.log('(자동 열기 실패 — 위 주소를 수동으로 열어주세요)');
  });
});
