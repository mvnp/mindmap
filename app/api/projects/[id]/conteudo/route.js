import { projectRole } from '@/lib/db';
import { listContents } from '@/lib/conteudo';
import { withAuth } from '@/lib/auth';
export const dynamic = 'force-dynamic';

// resumo dos blocos que têm conteúdo (para os selos): qualquer um com acesso ao projeto
export const GET = withAuth(async (_req, { params }, user) => {
  const id = Number((await params).id);
  if (!projectRole(user.id, id)) return Response.json({ error: 'projeto não encontrado' }, { status: 404 });
  return Response.json(listContents(id));
});
