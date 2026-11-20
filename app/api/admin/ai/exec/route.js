import { withAuth, fail } from '@/lib/auth';
import { execDbTool, hasJournal } from '@/lib/ai-db';
export const dynamic = 'force-dynamic';

// Executa uma ferramenta do assistente do banco (somente master). body: { name, input, run }
export const POST = withAuth(async (req, _ctx, user) => {
  try {
    const { name, input, run } = await req.json();
    const res = execDbTool(user, String(name), input, run);
    return Response.json({ ...res, undoable: hasJournal(run) });
  } catch (e) { return fail(e); }
}, { master: true });
