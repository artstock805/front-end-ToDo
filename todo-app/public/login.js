const $ = (sel) => document.querySelector(sel);
const form = $('#auth-form');
const errorEl = $('#auth-error');
const submitBtn = $('#auth-submit');
const hintEl = $('#auth-hint');
const tabLogin = $('#tab-login');
const tabSignup = $('#tab-signup');

let mode = 'login'; // 'login' | 'signup'

function setMode(next) {
  mode = next;
  const isLogin = mode === 'login';
  tabLogin.classList.toggle('active', isLogin);
  tabSignup.classList.toggle('active', !isLogin);
  submitBtn.textContent = isLogin ? '로그인' : '회원가입';
  hintEl.textContent = isLogin
    ? '계정이 없으신가요? 위 "회원가입"을 눌러주세요.'
    : '처음 가입하면 기존 할 일이 이 계정으로 옮겨집니다.';
  errorEl.hidden = true;
}

tabLogin.onclick = () => setMode('login');
tabSignup.onclick = () => setMode('signup');

// 이미 로그인 상태면 바로 앱으로
fetch('/api/auth/me')
  .then((r) => { if (r.ok) location.replace('/'); })
  .catch(() => {});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.hidden = true;
  const username = $('#username').value.trim();
  const password = $('#password').value;
  submitBtn.disabled = true;

  try {
    const res = await fetch(`/api/auth/${mode === 'login' ? 'login' : 'signup'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '요청에 실패했습니다.');

    if (mode === 'signup' && data.migrated > 0) {
      // 이전된 할 일이 있으면 잠깐 알림 후 이동
      alert(`가입 완료! 기존 할 일 ${data.migrated}건을 계정으로 옮겼어요.`);
    }
    location.replace('/');
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  } finally {
    submitBtn.disabled = false;
  }
});

setMode('login');
