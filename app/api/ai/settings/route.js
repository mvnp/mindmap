import { withAuth, fail } from '@/lib/auth';
import { publicSettings, saveSettings } from '@/lib/ai';
export const dynamic = 'force-dynamic';

// A chave da API nunca volta para o navegador: só "temChave" e uma dica com os últimos 4 caracteres.
export const GET = withAuth(async (_req, _ctx, user) => Response.json(publicSettings(user.id)));

export const PUT = withAuth(async (req, _ctx, user) => {
  try { return Response.json(saveSettings(user.id, await req.json())); } catch (e) { return fail(e); }
});

export const DELETE = withAuth(async (_req, _ctx, user) => {
  try { return Response.json(saveSettings(user.id, { removerChave: true })); } catch (e) { return fail(e); }
});
