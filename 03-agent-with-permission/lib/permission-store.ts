import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk';

interface PendingPermission {
  resolve: (result: PermissionResult) => void;
  toolName: string;
  toolUseId: string;
}

// 使用 globalThis 确保跨 route 共享同一个 Map
const STORE_KEY = '__permission_pending_store__';

function getStore(): Map<string, PendingPermission> {
  const g = globalThis as Record<string, unknown>;
  if (!g[STORE_KEY]) {
    g[STORE_KEY] = new Map<string, PendingPermission>();
  }
  return g[STORE_KEY] as Map<string, PendingPermission>;
}

export function addPending(
  requestId: string,
  toolName: string,
  toolUseId: string,
): Promise<PermissionResult> {
  return new Promise((resolve) => {
    getStore().set(requestId, { resolve, toolName, toolUseId });
  });
}

export function resolvePending(requestId: string, result: PermissionResult): boolean {
  const store = getStore();
  const entry = store.get(requestId);
  if (!entry) return false;
  entry.resolve(result);
  store.delete(requestId);
  return true;
}

export function removePending(requestId: string): void {
  getStore().delete(requestId);
}
