import { ownsProject, getProject, setVisibility } from '@/lib/db';
import { withAuth, fail, rateLimit, baseUrl } from '@/lib/auth';
import { createInvites, parseEmails } from '@/lib/share';
import { db } from '@/lib/db';
export const dynamic = 'force-dynamic';

// Convidar (só o dono): { emails: "a@x.com, b@y.com" | ["a@x.com", ...] }
export const POST = withAuth(async (req, { params }, user) => {
  try {
    const id = Number((await params).id);
    if (!ownsProject(user.id, id)) return Response.json({ error: 'projeto não encontrado' }, { status: 404 });
    rateLimit(`invite:${user.id}`, 20, 3600);
    const emails = parseEmails((await req.json()).emails);
    if (!emails.length) return Response.json({ error: 'Informe ao menos um e-mail' }, { status: 400 });
    const project = db.prepare('SELECT id, name, user_id, visibilidade FROM projects WHERE id = ?').get(id);
    const r = await createInvites({ project, inviter: user, emails, base: baseUrl(req) });
    // convidar um projeto privado o torna acessível aos convidados
    if (r.enviados.length && project.visibilidade === 'privado') setVisibility(id, 'convidados');
    return Response.json(r);
  } catch (e) { return fail(e); }
});
