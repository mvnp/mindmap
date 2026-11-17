import { deleteNode, HttpError } from '@/lib/db';
export const dynamic = 'force-dynamic';

// DELETE: remove o nó e todo o seu ramo (a raiz não pode ser removida)
export async function DELETE(_req, { params }) {
  const { id, nid } = await params;
  try { deleteNode(Number(id), nid); return Response.json({ ok: true }); }
  catch (e) { return Response.json({ error: e.message }, { status: e instanceof HttpError ? e.status : 500 }); }
}
