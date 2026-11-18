import { ownsProject, shareInfo, setVisibility, removeMember, removeInvite, HttpError } from '@/lib/db';
import { withAuth } from '@/lib/auth';
export const dynamic = 'force-dynamic';

const notFound = () => Response.json({ error: 'projeto não encontrado' }, { status: 404 });
const err = e => Response.json({ error: e.message }, { status: e instanceof HttpError ? e.status : 400 });

// dados de compartilhamento (só o dono): uuid, visibilidade, colaboradores e convites pendentes
export const GET = withAuth(async (_req, { params }, user) => {
  const id = Number((await params).id);
  return ownsProject(user.id, id) ? Response.json(shareInfo(id)) : notFound();
});

// { visibilidade: 'privado' | 'publico' | 'convidados' }
export const PATCH = withAuth(async (req, { params }, user) => {
  const id = Number((await params).id);
  if (!ownsProject(user.id, id)) return notFound();
  try { setVisibility(id, (await req.json()).visibilidade); return Response.json(shareInfo(id)); } catch (e) { return err(e); }
});

// { membro: userId } remove colaborador · { convite: inviteId } revoga convite pendente
export const DELETE = withAuth(async (req, { params }, user) => {
  const id = Number((await params).id);
  if (!ownsProject(user.id, id)) return notFound();
  try {
    const b = await req.json();
    if (b.membro) removeMember(id, Number(b.membro));
    if (b.convite) removeInvite(id, Number(b.convite));
    return Response.json(shareInfo(id));
  } catch (e) { return err(e); }
});
