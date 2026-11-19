import { withAuth, fail, rateLimit } from '@/lib/auth';
import { endRun } from '@/lib/ai';
export const dynamic = 'force-dynamic';

// o navegador avisa como o prompt terminou: concluido | parado | erro | limite (+ quantas ações foram executadas)
export const POST = withAuth(async (req, _ctx, user) => {
  try {
    rateLimit(`ai-end:${user.id}`, 300, 600);   // o aviso de fim pode criar registro: limita o volume
    const b = await req.json();
    return Response.json({ ok: endRun(user.id, b.run, { status: b.status, error: b.error, tools: b.tools, project: b.project, prompt: b.prompt }) });
  } catch (e) { return fail(e); }
});
