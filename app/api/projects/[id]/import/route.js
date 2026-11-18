import { importMap, canEditProject, HttpError } from '@/lib/db';
import { withAuth } from '@/lib/auth';
export const dynamic = 'force-dynamic';

export const POST = withAuth(async (req, { params }, user) => {
  const id = Number((await params).id);
  if (!canEditProject(user.id, id)) return Response.json({ error: 'projeto não encontrado' }, { status: 404 });
  try { importMap(id, await req.json()); return Response.json({ ok: true }); }
  catch (e) {
    if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }
});
