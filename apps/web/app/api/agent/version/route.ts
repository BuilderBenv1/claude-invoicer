import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Which commit is actually serving. Deploys are the one thing that cannot be
 * checked from the outside — a failed Vercel build leaves the previous version
 * live and looks identical to a slow one, so "I pushed the fix" and "the fix is
 * running" quietly drift apart. Token-gated rather than public: it is only a
 * commit SHA, but there is no reason to hand it to anyone who asks.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const token = process.env.AGENT_TOKEN;
  const provided = req.headers.get('authorization') ?? '';
  if (!token || provided !== `Bearer ${token}`) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  return Response.json({
    ok: true,
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local',
    message: process.env.VERCEL_GIT_COMMIT_MESSAGE?.split('\n')[0] ?? null,
    env: process.env.VERCEL_ENV ?? 'development',
  });
}
