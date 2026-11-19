import { withAuth, fail } from '@/lib/auth';
import { clientFor, friendlyError, aiRateLimit } from '@/lib/ai';
export const dynamic = 'force-dynamic';

// "Testar conexão": consulta o modelo escolhido com a chave salva (não gera texto, não gasta tokens)
export const POST = withAuth(async (_req, _ctx, user) => {
  try {
    aiRateLimit(user.id);
    const { client, settings } = clientFor(user.id);
    try {
      const m = await client.models.retrieve(settings.model);
      return Response.json({ ok: true, modelo: m?.display_name || settings.model });
    } catch (e) {
      const f = friendlyError(e);
      return Response.json({ ok: false, error: f.error }, { status: 200 });
    }
  } catch (e) { return fail(e); }
});
