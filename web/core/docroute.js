// Кто превращает документ from -> to на ПК: LibreOffice (офисные форматы), pandoc (markdown) или
// встроенный модуль (всегда есть, им же работает браузер). null - превращать нечего.
const SOFFICE_IN = ['doc', 'docx', 'odt', 'rtf', 'html', 'txt'];
const SOFFICE_OUT = ['pdf', 'docx', 'odt', 'rtf', 'html', 'txt'];
const PANDOC = ['md', 'html', 'docx', 'odt', 'txt', 'rtf'];

export function officeRoute(from, to, { soffice, pandoc } = {}) {
  if (from === to) return null;
  if (soffice && SOFFICE_IN.includes(from) && SOFFICE_OUT.includes(to)) return 'soffice';
  if (pandoc && PANDOC.includes(from) && PANDOC.includes(to) && from !== 'txt') return 'pandoc';
  if (soffice && pandoc && from === 'md' && to === 'pdf') return 'pandoc+soffice';
  return 'builtin';
}
