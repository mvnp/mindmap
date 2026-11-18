import { listFeatures } from '@/lib/db';
import { withAuth } from '@/lib/auth';
export const dynamic = 'force-dynamic';

export const GET = withAuth(async () => Response.json(listFeatures()));
