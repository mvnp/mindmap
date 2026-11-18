import { withAuth } from '@/lib/auth';
export const dynamic = 'force-dynamic';

export const GET = withAuth(async (_req, _ctx, user) => Response.json({ user }));
