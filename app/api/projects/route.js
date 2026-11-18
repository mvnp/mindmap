import { listProjects, createProject, getProjectUuid } from '@/lib/db';
import { withAuth } from '@/lib/auth';
export const dynamic = 'force-dynamic';

export const GET = withAuth(async (_req, _ctx, user) => Response.json(listProjects(user.id)));

export const POST = withAuth(async (req, _ctx, user) => {
  const b = await req.json().catch(() => ({}));
  const name = String(b.name || '').trim().slice(0, 120) || 'Novo projeto';
  const id = createProject(name, null, user.id);
  return Response.json({ id, name, uuid: getProjectUuid(id) }, { status: 201 });
});
