import { withAuth } from '@/lib/auth';
import { usageSummary } from '@/lib/ai';
export const dynamic = 'force-dynamic';

// consumo do próprio usuário: últimas 24 h, 30 dias e os últimos prompts
export const GET = withAuth(async (_req, _ctx, user) => Response.json(usageSummary(user.id)));
