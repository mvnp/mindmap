import { consumeAuthToken, validatePassword, setPassword, destroyUserSessions, rateLimit, clientIp, AuthError, fail } from '@/lib/auth';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  try {
    rateLimit(`reset:${clientIp(req)}`, 10, 15 * 60);
    const { token, senha } = await req.json();
    validatePassword(senha);
    const userId = consumeAuthToken(token, 'redefinicao');
    if (!userId) throw new AuthError(400, 'Link inválido ou expirado');
    setPassword(userId, senha);
    destroyUserSessions(userId);   // encerra sessões antigas
    return Response.json({ ok: true });
  } catch (e) { return fail(e); }
}
