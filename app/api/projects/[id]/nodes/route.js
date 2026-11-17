import { createNode, updateNodes, replaceMap, getProject, HttpError } from '@/lib/db';
export const dynamic = 'force-dynamic';

const fail = e => e instanceof HttpError
  ? Response.json({ error: e.message }, { status: e.status })
  : Response.json({ error: String(e.message || e) }, { status: 500 });

// CREATE: { node, after? }
export async function POST(req, { params }) {
  const id = Number((await params).id);
  if (!getProject(id)) return Response.json({ error: 'projeto não encontrado' }, { status: 404 });
  try { const b = await req.json(); createNode(id, b.node, b.after); return Response.json({ ok: true }, { status: 201 }); }
  catch (e) { return fail(e); }
}

// UPDATE (em lote): { patches: [{ id, text?, x?, y?, color?, size?, bold?, collapsed?, parent? }] }
export async function PATCH(req, { params }) {
  const id = Number((await params).id);
  try {
    const b = await req.json();
    if (!Array.isArray(b.patches)) return Response.json({ error: 'patches inválido' }, { status: 400 });
    updateNodes(id, b.patches); return Response.json({ ok: true });
  } catch (e) { return fail(e); }
}

// PUT: snapshot completo (rede de segurança ao fechar/recarregar a página)
export async function PUT(req, { params }) {
  const id = Number((await params).id);
  if (!getProject(id)) return Response.json({ error: 'projeto não encontrado' }, { status: 404 });
  try { replaceMap(id, await req.json()); return Response.json({ ok: true }); }
  catch (e) { return fail(e); }
}
