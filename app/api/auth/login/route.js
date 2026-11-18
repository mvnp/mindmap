import { checkLogin, createSession, sessionCookie, rateLimit, clientIp, publicUser, fail } from '@/lib/auth';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  try {
    const b = await req.json();
    rateLimit(`login-ip:${clientIp(req)}`, 30, 15 * 60);
    rateLimit(`login:${clientIp(req)}:${String(b?.email ?? '').toLowerCase()}`, 8, 15 * 60);
    const u = checkLogin(b?.email, b?.senha);
    const { token, maxAge } = createSession(u.id);
    return Response.json({ user: publicUser(u) }, { headers: { 'Set-Cookie': sessionCookie(req, token, maxAge) } });
  } catch (e) { return fail(e); }
}
