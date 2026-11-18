import { acceptInvite } from '@/lib/share';
import { withAuth, fail } from '@/lib/auth';
export const dynamic = 'force-dynamic';

export const POST = withAuth(async (_req, { params }, user) => {
  try { return Response.json(acceptInvite((await params).token, user)); }
  catch (e) { return fail(e); }
});
