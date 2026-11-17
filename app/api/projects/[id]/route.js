import { getProject, renameProject, deleteProject, saveView } from '@/lib/db';
export const dynamic = 'force-dynamic';

export async function GET(_req, { params }) {
  const data = getProject(Number((await params).id));
  return data ? Response.json(data) : Response.json({ error: 'não encontrado' }, { status: 404 });
}

export async function PATCH(req, { params }) {
  const id = Number((await params).id);
  const { name, view } = await req.json();
  if (view !== undefined) { saveView(id, view); if (name === undefined) return Response.json({ ok: true }); }
  if (!String(name || '').trim()) return Response.json({ error: 'nome vazio' }, { status: 400 });
  renameProject(id, String(name).trim());
  return Response.json({ id, name });
}

export async function DELETE(_req, { params }) {
  deleteProject(Number((await params).id));
  return Response.json({ ok: true });
}
