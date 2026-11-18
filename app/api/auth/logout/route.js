import { destroySession, sessionTokenOf, clearCookie } from '@/lib/auth';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  destroySession(sessionTokenOf(req));
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': clearCookie(req) } });
}
