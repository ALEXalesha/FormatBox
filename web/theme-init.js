// Тема до первой отрисовки, чтобы не мигало (отдельным файлом: CSP запрещает встроенные скрипты)
try {
  const th = localStorage.getItem('fb.theme');
  if (th && th !== 'glass') document.documentElement.dataset.theme = th;
} catch (e) { /* storage off */ }
