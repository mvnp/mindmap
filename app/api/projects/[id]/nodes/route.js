import { createNode, updateNodes, replaceMap, canEditProject, HttpError } from '@/lib/db';
import { withAuth } from '@/lib/auth';
export const dynamic = 'force-dynamic';

const fail = e => e instanceof HttpError
  ? Response.json({ error: e.message }, { status: e.status })
  : Response.json({ error: String(e.message || e) }, { status: 500 });
const notFound = () => Response.json({ error: 'projeto não encontrado' }, { status: 404 });

// CREATE: { node, after? }
export const POST = withAuth(async (req, { params }, user) => {
  const id = Number((await params).id);
  if (!canEditProject(user.id, id)) return notFound();
  try { const b = await req.json(); createNode(id, b.node, b.after); return Response.json({ ok: true }, { status: 201 }); }
  catch (e) { return fail(e); }
});

// UPDATE (em lote): { patches: [{ id, text?, x?, y?, color?, size?, bold?, collapsed?, parent?, ... }] }
export const PATCH = withAuth(async (req, { params }, user) => {
  const id = Number((await params).id);
  if (!canEditProject(user.id, id)) return notFound();
  try {
    const b = await req.json();
    if (!Array.isArray(b.patches)) return Response.json({ error: 'patches inválido' }, { status: 400 });
    updateNodes(id, b.patches); return Response.json({ ok: true });
  } catch (e) { return fail(e); }
});

// PUT: snapshot completo (rede de segurança ao fechar/recarregar a página)
export const PUT = withAuth(async (req, { params }, user) => {
  const id = Number((await params).id);
  if (!canEditProject(user.id, id)) return notFound();
  try { replaceMap(id, await req.json()); return Response.json({ ok: true }); }
  catch (e) { return fail(e); }
});
