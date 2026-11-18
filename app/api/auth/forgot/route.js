import { findUserByEmail, createAuthToken, rateLimit, clientIp, baseUrl, fail } from '@/lib/auth';
import { sendMail, linkMail } from '@/lib/mailer';
export const dynamic = 'force-dynamic';

const MENSAGEM = 'Caso exista um cadastro em nossa base de dados, você receberá convite para reiniciar sua senha. Obrigado.';

// Esqueci a senha: sempre responde igual (não revela se o e-mail existe).
export async function POST(req) {
  try {
    rateLimit(`forgot:${clientIp(req)}`, 5, 15 * 60);
    const { email } = await req.json();
    const u = findUserByEmail(email || '');
    if (u) {
      const token = createAuthToken(u.id, 'redefinicao', 3600);
      await sendMail({ to: u.email, subject: 'Redefinição de senha', ...linkMail({
        titulo: 'Redefinição de senha', texto: 'Recebemos um pedido para redefinir a sua senha. O link vale por 1 hora. Se não foi você, ignore este e-mail.',
        botao: 'Criar nova senha', link: `${baseUrl(req)}/redefinir-senha?token=${token}` }) });
    }
    return Response.json({ ok: true, mensagem: MENSAGEM });
  } catch (e) { return fail(e); }
}
