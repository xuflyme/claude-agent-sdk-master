import { NextRequest } from 'next/server';
import { resolvePending } from '@/lib/permission-store';

interface PermissionDecision {
  requestId: string;
  behavior: 'allow' | 'deny';
  message?: string;
  updatedInput?: Record<string, unknown>;
  updatedPermissions?: unknown[];
}

export async function POST(req: NextRequest) {
  const body: PermissionDecision = await req.json();
  const { requestId, behavior, message, updatedInput, updatedPermissions } = body;

  if (!requestId || !behavior) {
    return new Response(
      JSON.stringify({ error: 'requestId and behavior are required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const result = behavior === 'allow'
    ? { behavior: 'allow' as const, updatedInput, updatedPermissions }
    : { behavior: 'deny' as const, message: message || 'User denied permission' };

  const resolved = resolvePending(requestId, result);

  return new Response(
    JSON.stringify({ ok: resolved }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}
