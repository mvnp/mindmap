import { importMap, getProject, HttpError } from '@/lib/db';
export const dynamic = 'force-dynamic';

export async function POST(req, { params }) {
  const id = Number((await params).id);
  if (!getProject(id)) return Response.json({ error: 'projeto não encontrado' }, { status: 404 });
  try { importMap(id, await req.json()); return Response.json({ ok: true }); }
  catch (e) {
    if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }
}
