import { projectRole, canEditProject, HttpError } from '@/lib/db';
import { getContent, saveContent, deleteContent, LIMITS } from '@/lib/conteudo';
import { withAuth } from '@/lib/auth';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const notFound = () => Response.json({ error: 'não encontrado' }, { status: 404 });
const fail = e => e instanceof HttpError
  ? Response.json({ error: e.message }, { status: e.status })
  : (console.error('conteudo:', e), Response.json({ error: 'erro ao processar o conteúdo' }, { status: 500 }));

export const GET = withAuth(async (_req, { params }, user) => {
  const { id, nid } = await params; const pid = Number(id);
  if (!projectRole(user.id, pid)) return notFound();
  return Response.json(getContent(pid, decodeURIComponent(nid)) || { node_id: nid, titulo: '', corpo: '', arquivos: [] });
});

// salvar: multipart/form-data com titulo, corpo, remover (JSON com ids) e arquivos (vários)
export const PUT = withAuth(async (req, { params }, user) => {
  const { id, nid } = await params; const pid = Number(id);
  if (!canEditProject(user.id, pid)) return notFound();
  try {
    if (Number(req.headers.get('content-length') || 0) > LIMITS.porEnvio + 1024 * 1024) throw new HttpError(413, `O envio passa de ${LIMITS.porEnvio / 1024 / 1024} MB`);
    const fd = await req.formData();
    let remover = []; try { remover = JSON.parse(String(fd.get('remover') || '[]')); } catch {}
    const files = [];
    let total = 0;
    for (const f of fd.getAll('arquivos')) {
      if (typeof f === 'string') continue;
      total += f.size; if (total > LIMITS.porEnvio) throw new HttpError(413, `O envio passa de ${LIMITS.porEnvio / 1024 / 1024} MB`);
      if (f.size > LIMITS.arquivo) throw new HttpError(400, `“${f.name}” passa de ${LIMITS.arquivo / 1024 / 1024} MB`);
      files.push({ name: f.name, buf: Buffer.from(await f.arrayBuffer()) });
    }
    return Response.json(saveContent(pid, decodeURIComponent(nid), user.id, { titulo: fd.get('titulo'), corpo: fd.get('corpo'), files, remover: Array.isArray(remover) ? remover : [] }));
  } catch (e) { return fail(e); }
});

export const DELETE = withAuth(async (_req, { params }, user) => {
  const { id, nid } = await params; const pid = Number(id);
  if (!canEditProject(user.id, pid)) return notFound();
  deleteContent(pid, decodeURIComponent(nid));
  return Response.json({ ok: true });
});
