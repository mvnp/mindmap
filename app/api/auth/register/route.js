import { validateRegister, createUser, createAuthToken, rateLimit, clientIp, baseUrl, fail } from '@/lib/auth';
import { createStarterProjects } from '@/lib/db';
import { sendMail, linkMail } from '@/lib/mailer';
export const dynamic = 'force-dynamic';

// Cadastro. A conta nasce NÃO verificada: só entra depois de clicar no link de confirmação enviado por e-mail.
export async function POST(req) {
  try {
    rateLimit(`reg:${clientIp(req)}`, 10, 3600);
    const v = validateRegister(await req.json());
    const id = createUser({ ...v, verificado: false, master: false });
    createStarterProjects(id);
    const token = createAuthToken(id, 'verificacao', 7 * 24 * 3600);
    await sendMail({ to: v.email, subject: 'Confirme seu e-mail', ...linkMail({
      titulo: `Olá, ${v.nome}! Confirme seu e-mail`, texto: 'Obrigado por se cadastrar no Mindmap. Clique no botão abaixo para confirmar o seu e-mail.',
      botao: 'Confirmar e-mail', link: `${baseUrl(req)}/verificar?token=${token}` }) });
    return Response.json({ ok: true }, { status: 201 });
  } catch (e) { return fail(e); }
}
