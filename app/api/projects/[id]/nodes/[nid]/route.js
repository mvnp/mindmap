import { deleteNode, canEditProject, HttpError } from '@/lib/db';
import { withAuth } from '@/lib/auth';
export const dynamic = 'force-dynamic';

// DELETE: remove o nó e todo o seu ramo (a raiz não pode ser removida)
export const DELETE = withAuth(async (_req, { params }, user) => {
  const { id, nid } = await params;
  if (!canEditProject(user.id, Number(id))) return Response.json({ error: 'projeto não encontrado' }, { status: 404 });
  try { deleteNode(Number(id), nid); return Response.json({ ok: true }); }
  catch (e) { return Response.json({ error: e.message }, { status: e instanceof HttpError ? e.status : 500 }); }
});
