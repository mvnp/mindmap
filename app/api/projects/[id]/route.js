import { getProject, renameProject, updateProject, deleteProject, saveView, ownsProject, canEditProject } from '@/lib/db';
import { withAuth } from '@/lib/auth';
export const dynamic = 'force-dynamic';

const notFound = () => Response.json({ error: 'não encontrado' }, { status: 404 });

export const GET = withAuth(async (_req, { params }, user) => {
  const id = Number((await params).id);
  return canEditProject(user.id, id) ? Response.json(getProject(id)) : notFound();
});

export const PATCH = withAuth(async (req, { params }, user) => {
  const id = Number((await params).id);
  const { name, view, descricao } = await req.json();
  if (view !== undefined) {   // colaboradores também gravam a visão
    if (!canEditProject(user.id, id)) return notFound();
    saveView(id, view); if (name === undefined) return Response.json({ ok: true });
  }
  if (!ownsProject(user.id, id)) return notFound();
  if (!String(name || '').trim()) return Response.json({ error: 'nome vazio' }, { status: 400 });
  const nm = String(name).trim().slice(0, 120);
  if (descricao === undefined) renameProject(id, nm);
  else updateProject(id, nm, String(descricao ?? '').trim().slice(0, 1000));
  return Response.json({ id, name: nm });
});

export const DELETE = withAuth(async (_req, { params }, user) => {
  const id = Number((await params).id);
  if (!ownsProject(user.id, id)) return notFound();
  deleteProject(id);
  return Response.json({ ok: true });
});
