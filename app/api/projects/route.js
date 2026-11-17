import { listProjects, createProject } from '@/lib/db';
export const dynamic = 'force-dynamic';

export async function GET() { return Response.json(listProjects()); }

export async function POST(req) {
  const b = await req.json().catch(() => ({}));
  const name = String(b.name || '').trim() || 'Novo projeto';
  return Response.json({ id: createProject(name), name }, { status: 201 });
}
