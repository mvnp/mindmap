import { registerViaInvite } from '@/lib/share';
import { fail, rateLimit, clientIp, baseUrl } from '@/lib/auth';
export const dynamic = 'force-dynamic';

// público: cadastro a partir do convite (conta criada sem verificação; o e-mail de confirmação é enviado)
export async function POST(req, { params }) {
  try {
    rateLimit(`inv-reg:${clientIp(req)}`, 10, 3600);
    await registerViaInvite((await params).token, await req.json(), baseUrl(req));
    return Response.json({ ok: true }, { status: 201 });
  } catch (e) { return fail(e); }
}
