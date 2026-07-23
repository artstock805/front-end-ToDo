/**
 * 인증 모듈
 * - 비밀번호: Node 내장 crypto.scrypt로 해시(솔트 포함). 외부 의존성 없음.
 * - 세션: 불투명 랜덤 토큰을 sessions 테이블에 저장하고 httpOnly 쿠키(sid)로 전달.
 */
import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import db from './db.js';

const scryptAsync = promisify(scrypt);
const SESSION_DAYS = 30;
const COOKIE_NAME = 'sid';

// ── 비밀번호 ────────────────────────────────────────────────
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scryptAsync(password, salt, 64)).toString('hex');
  return `${salt}:${derived}`;
}

export async function verifyPassword(password, stored) {
  const [salt, key] = String(stored).split(':');
  if (!salt || !key) return false;
  const keyBuf = Buffer.from(key, 'hex');
  const derived = await scryptAsync(password, salt, 64);
  return keyBuf.length === derived.length && timingSafeEqual(keyBuf, derived);
}

// ── 세션 ───────────────────────────────────────────────────
export function createSession(userId) {
  const token = randomBytes(32).toString('hex');
  db.prepare(
    `INSERT INTO sessions (token, user_id, expires_at)
     VALUES (?, ?, datetime('now', ?))`
  ).run(token, userId, `+${SESSION_DAYS} days`);
  return token;
}

export function getSessionUser(token) {
  if (!token) return null;
  return (
    db
      .prepare(
        `SELECT s.user_id AS id, u.username
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token = ? AND s.expires_at > datetime('now')`
      )
      .get(token) || null
  );
}

export function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

// ── 쿠키 ───────────────────────────────────────────────────
export function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

// HTTPS(터널/프록시 포함) 접속이면 Secure 플래그를 붙인다.
// app.set('trust proxy', true) 덕분에 req.secure가 X-Forwarded-Proto를 반영한다.
// 로컬 http(localhost) 접속에서는 Secure를 빼야 쿠키가 정상 저장된다.
function secureFlag(req) {
  return req && req.secure ? '; Secure' : '';
}

export function setSessionCookie(req, res, token) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secureFlag(req)}`
  );
}

export function clearSessionCookie(req, res) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureFlag(req)}`
  );
}

// ── 미들웨어 ────────────────────────────────────────────────
export function requireAuth(req, res, next) {
  const token = parseCookies(req)[COOKIE_NAME];
  const user = getSessionUser(token);
  if (!user) return res.status(401).json({ error: '로그인이 필요합니다.' });
  req.userId = user.id;
  req.username = user.username;
  req.sessionToken = token;
  next();
}

export { COOKIE_NAME };
