import { withAuth, fail } from '@/lib/auth';
import { undoRun } from '@/lib/ai-db';
export const dynamic = 'force-dynamic';

// Desfaz tudo o que o assistente do banco fez numa missão (somente master). body: { run }
export const POST = withAuth(async (req) => {
  try { return Response.json(undoRun(String((await req.json()).run))); }
  catch (e) { return fail(e); }
}, { master: true });
