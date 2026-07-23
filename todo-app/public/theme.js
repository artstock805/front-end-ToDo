// 라이트/다크 테마 토글 (localStorage 기억 + 시스템 설정 기본값)
(function () {
  const KEY = 'todo-theme';
  const root = document.documentElement;

  const current = () => root.dataset.theme || 'light';

  function updateBtn(theme) {
    const btn = document.getElementById('theme-toggle');
    if (btn) {
      btn.textContent = theme === 'dark' ? '☀️' : '🌙';
      btn.setAttribute('aria-label', theme === 'dark' ? '라이트 모드로' : '다크 모드로');
    }
  }

  function apply(theme) {
    root.dataset.theme = theme;
    try {
      localStorage.setItem(KEY, theme);
    } catch (e) {
      /* localStorage 불가 시 무시 */
    }
    updateBtn(theme);
  }

  window.addEventListener('DOMContentLoaded', () => {
    updateBtn(current());
    const btn = document.getElementById('theme-toggle');
    if (btn) {
      btn.addEventListener('click', () => apply(current() === 'dark' ? 'light' : 'dark'));
    }
  });
})();
