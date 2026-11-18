import { consumeAuthToken, markVerified, rateLimit, clientIp, AuthError, fail } from '@/lib/auth';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  try {
    rateLimit(`verify:${clientIp(req)}`, 20, 15 * 60);
    const { token } = await req.json();
    const userId = consumeAuthToken(token, 'verificacao');
    if (!userId) throw new AuthError(400, 'Link inválido ou expirado');
    markVerified(userId);
    return Response.json({ ok: true });
  } catch (e) { return fail(e); }
}
