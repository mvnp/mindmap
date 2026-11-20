// Envio de e-mails por SMTP (nodemailer). Configuração por variáveis de ambiente (arquivo .env, fora do git):
//   MYSMTP_HOST, MYSMTP_PORT, MYSMTP_USER, MYSMTP_PASS, MYSMTP_FROM
// Sem MYSMTP_HOST, o e-mail só é escrito no log do servidor (docker logs mindmap).
import nodemailer from 'nodemailer';

function transport() {
  const g = (globalThis.__mmmail ??= {});
  if (g.t === undefined) {
    g.t = process.env.MYSMTP_HOST
      ? nodemailer.createTransport({
          host: process.env.MYSMTP_HOST,
          port: Number(process.env.MYSMTP_PORT) || 587,
          secure: Number(process.env.MYSMTP_PORT) === 465,
          auth: process.env.MYSMTP_USER ? { user: process.env.MYSMTP_USER, pass: process.env.MYSMTP_PASS } : undefined,
        })
      : null;
  }
  return g.t;
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// corpo padrão (texto + HTML) dos e-mails com link especial
export function linkMail({ titulo, texto, botao, link }) {
  return {
    text: `${titulo}\n\n${texto}\n\n${botao}: ${link}\n`,
    html: `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:480px;margin:auto;padding:24px;color:#222">
  <div style="font-size:22px;margin-bottom:16px">mind<b style="color:#ff6b6b">map</b></div>
  <h2 style="margin:0 0 12px">${esc(titulo)}</h2>
  <p style="line-height:1.5">${esc(texto)}</p>
  <p><a href="${esc(link)}" style="display:inline-block;background:#4f7cf7;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600">${esc(botao)}</a></p>
  <p style="color:#888;font-size:12px;word-break:break-all">Se o botão não funcionar, copie este endereço no navegador:<br>${esc(link)}</p>
</div>`,
  };
}

// nunca lança erro: falha de e-mail não pode derrubar o cadastro nem revelar se o e-mail existe
export async function sendMail({ to, subject, text, html }) {
  const t = transport();
  if (!t) { console.log(`\n[mail] (sem SMTP) Para: ${to}\n[mail] Assunto: ${subject}\n[mail] ${text}\n`); return 'log'; }
  try {
    const info = await t.sendMail({ from: process.env.MYSMTP_FROM || 'Mindmap <no-reply@mindmap.local>', to, subject, text, html });
    console.log(`[mail] enviado para ${to}: ${subject} (${info.messageId})`);
    return 'smtp';
  } catch (e) {
    console.error(`[mail] falha ao enviar para ${to}: ${e.message}`);
    return false;
  }
}
