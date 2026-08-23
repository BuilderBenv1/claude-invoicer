import type { NextRequest } from 'next/server';
import { buildAgentBriefs } from '@/lib/milestone-file';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const token = process.env.AGENT_TOKEN;
  const provided = req.headers.get('authorization') ?? '';
  if (!token || provided !== `Bearer ${token}`) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  return Response.json({ briefs: await buildAgentBriefs() });
}
