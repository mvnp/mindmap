import { acceptNotification, declineNotification } from '@/lib/share';
import { withAuth, fail } from '@/lib/auth';
export const dynamic = 'force-dynamic';

// body: { acao: 'aceitar' | 'recusar' }
export const POST = withAuth(async (req, { params }, user) => {
  try {
    const id = (await params).id;
    const { acao } = await req.json().catch(() => ({}));
    if (acao === 'aceitar') return Response.json(acceptNotification(id, user));
    if (acao === 'recusar') return Response.json(declineNotification(id, user));
    return Response.json({ error: 'ação inválida' }, { status: 400 });
  } catch (e) { return fail(e); }
});
