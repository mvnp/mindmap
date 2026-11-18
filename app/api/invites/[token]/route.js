import { inviteInfo, } from '@/lib/share';
import { fail, rateLimit, clientIp } from '@/lib/auth';
export const dynamic = 'force-dynamic';

// público: dados do convite para a página de destino
export async function GET(req, { params }) {
  try {
    rateLimit(`inv-info:${clientIp(req)}`, 60, 15 * 60);
    return Response.json(inviteInfo((await params).token));
  } catch (e) { return fail(e); }
}
