import { findUserByEmail, createAuthToken, rateLimit, clientIp, baseUrl, fail } from '@/lib/auth';
import { sendMail, linkMail } from '@/lib/mailer';
export const dynamic = 'force-dynamic';

// Reenvia o link de confirmação. Resposta sempre igual (não revela se o e-mail existe).
export async function POST(req) {
  try {
    rateLimit(`resend:${clientIp(req)}`, 5, 15 * 60);
    const { email } = await req.json();
    const u = findUserByEmail(email || '');
    if (u && !u.verificado) {
      const token = createAuthToken(u.id, 'verificacao', 7 * 24 * 3600);
      await sendMail({ to: u.email, subject: 'Confirme seu e-mail', ...linkMail({
        titulo: `Olá, ${u.nome}! Confirme seu e-mail`, texto: 'Clique no botão abaixo para confirmar o seu e-mail e poder entrar.',
        botao: 'Confirmar e-mail', link: `${baseUrl(req)}/verificar?token=${token}` }) });
    }
    return Response.json({ ok: true });
  } catch (e) { return fail(e); }
}
