// Higieniza o texto formatado (HTML) do conteúdo dos blocos — sempre que for mostrado ou salvo. Só roda no navegador.
import DOMPurify from 'dompurify';

const CFG = { ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'a', 'div', 'span'], ALLOWED_ATTR: ['href'], ALLOW_DATA_ATTR: false };
let hooked = false;
export function clean(html) {
  if (typeof window === 'undefined' || !DOMPurify.isSupported) return '';
  if (!hooked) {
    hooked = true;
    DOMPurify.addHook('afterSanitizeAttributes', n => { if (n.tagName === 'A') { n.setAttribute('target', '_blank'); n.setAttribute('rel', 'noopener noreferrer'); } });
  }
  return DOMPurify.sanitize(String(html ?? ''), CFG);
}
export const isEmptyHtml = html => !String(html || '').replace(/<[^>]*>|&nbsp;|\s/g, '');
export const fmtSize = b => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`);
export const TIPO_ICON = { texto: '📄', imagem: '🖼️', pdf: '📕', audio: '🎧' };
