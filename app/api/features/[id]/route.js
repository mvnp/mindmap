import { setFeatureChecked, HttpError } from '@/lib/db';
export const dynamic = 'force-dynamic';

// PATCH { checked: boolean } — marca/desmarca a funcionalidade como desenvolvida
export async function PATCH(req, { params }) {
  try {
    const { checked } = await req.json();
    setFeatureChecked(Number((await params).id), !!checked);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: e instanceof HttpError ? e.status : 400 });
  }
}
