import { withAuth, listTables } from '@/lib/auth';
export const dynamic = 'force-dynamic';

export const GET = withAuth(async () => Response.json(listTables()), { master: true });
