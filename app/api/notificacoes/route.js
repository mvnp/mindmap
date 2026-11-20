import { listNotifications } from '@/lib/share';
import { withAuth } from '@/lib/auth';
export const dynamic = 'force-dynamic';

// convites pendentes para o e-mail da conta logada
export const GET = withAuth(async (_req, _ctx, user) => Response.json(listNotifications(user)));
