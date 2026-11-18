import { setFeatureChecked, HttpError } from '@/lib/db';
import { withAuth } from '@/lib/auth';
export const dynamic = 'force-dynamic';

// PATCH { checked: boolean } — só o master marca/desmarca funcionalidades como desenvolvidas
export const PATCH = withAuth(async (req, { params }) => {
  try {
    const { checked } = await req.json();
    setFeatureChecked(Number((await params).id), !!checked);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: e instanceof HttpError ? e.status : 400 });
  }
}, { master: true });
