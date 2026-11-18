import { withAuth, readTable, updateCell, fail } from '@/lib/auth';
export const dynamic = 'force-dynamic';

export const GET = withAuth(async (req, { params }) => {
  try {
    const u = new URL(req.url);
    const limit = Math.min(500, Math.max(1, Number(u.searchParams.get('limit')) || 100));
    const offset = Math.max(0, Number(u.searchParams.get('offset')) || 0);
    return Response.json(readTable((await params).name, limit, offset));
  } catch (e) { return fail(e); }
}, { master: true });

// PATCH { rowid, column, value } — edita uma célula (value: null grava NULL)
export const PATCH = withAuth(async (req, { params }) => {
  try {
    const b = await req.json();
    const row = updateCell((await params).name, Number(b.rowid), String(b.column), b.value === undefined ? null : b.value);
    return Response.json({ ok: true, row });
  } catch (e) { return fail(e); }
}, { master: true });
