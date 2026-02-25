/**
 * 权限管理模块
 *
 * 提供 Claude Agent SDK 权限功能的演示和学习材料，包括：
 * 1. 权限模式选择和描述
 * 2. 自定义 canUseTool 回调
 * 3. PreToolUse Hook 权限拦截
 * 4. 权限日志管理和可视化
 *
 * SDK 权限模式说明:
 * - default: 标准模式，危险操作需要用户确认
 * - acceptEdits: 自动接受文件编辑操作
 * - bypassPermissions: 绕过所有权限检查（需要 allowDangerouslySkipPermissions）
 * - plan: 规划模式，不执行工具，仅规划
 * - delegate: 委托模式，仅限 Teammate 和 Task 工具
 * - dontAsk: 不询问模式，未预批准则拒绝
 */

import type {
  PermissionMode,
  PermissionResult,
  PermissionUpdate,
  HookInput,
  HookJSONOutput,
  HookEvent,
  HookCallbackMatcher,
  PreToolUseHookInput,
  PreToolUseHookSpecificOutput,
} from '@anthropic-ai/claude-agent-sdk';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 权限配置接口
 * 控制 playground 的权限行为
 */
export interface PermissionConfig {
  /** 当前权限模式 */
  mode: PermissionMode;
  /** 是否启用自定义 canUseTool 回调 */
  enableCustomCanUseTool: boolean;
  /** 是否启用 PreToolUse Hook */
  enablePreToolUseHook: boolean;
  /** 是否显示详细的权限日志 */
  verbosePermissionLog: boolean;
  /** 允许自动批准的工具列表 */
  autoAllowedTools: string[];
  /** 总是拒绝的工具列表 */
  deniedTools: string[];
}

/**
 * 权限日志条目
 * 记录每次权限决策的详细信息
 */
export interface PermissionLogEntry {
  timestamp: Date;
  toolName: string;
  toolUseId: string;
  input: Record<string, unknown>;
  source: 'canUseTool' | 'PreToolUseHook' | 'PermissionRequestHook';
  decision: 'allow' | 'deny' | 'ask';
  reason?: string;
  suggestions?: PermissionUpdate[];
  blockedPath?: string;
}

/**
 * canUseTool 回调的选项参数接口
 * 对应 SDK 的 CanUseTool 回调的第三个参数
 */
export interface CanUseToolOptions {
  signal: AbortSignal;
  suggestions?: PermissionUpdate[];
  blockedPath?: string;
  decisionReason?: string;
  toolUseID: string;
  agentID?: string;
}

// ============================================================================
// 默认配置
// ============================================================================

export const DEFAULT_PERMISSION_CONFIG: PermissionConfig = {
  mode: 'bypassPermissions',
  enableCustomCanUseTool: false,
  enablePreToolUseHook: false,
  verbosePermissionLog: false,
  autoAllowedTools: ['Read', 'Glob', 'Grep'],
  deniedTools: [],
};

// ============================================================================
// 权限模式描述
// ============================================================================

export const PERMISSION_MODE_DESCRIPTIONS: Record<PermissionMode, string> = {
  default: '标准模式 - 危险操作需要确认',
  acceptEdits: '自动接受编辑 - 文件编辑自动批准',
  bypassPermissions: '绕过权限 - 跳过所有权限检查',
  plan: '规划模式 - 不执行工具，仅规划',
  delegate: '委托模式 - 仅限 Teammate 和 Task 工具',
  dontAsk: '不询问模式 - 未预批准则拒绝',
};

// ============================================================================
// 权限日志管理
// ============================================================================

/** 权限日志存储 */
const permissionLogs: PermissionLogEntry[] = [];

/** 添加权限日志 */
export function addPermissionLog(entry: PermissionLogEntry): void {
  permissionLogs.push(entry);
  // 保留最近 100 条
  if (permissionLogs.length > 100) {
    permissionLogs.shift();
  }
}

/** 获取权限日志 */
export function getPermissionLogs(): ReadonlyArray<PermissionLogEntry> {
  return permissionLogs;
}

/** 清空权限日志 */
export function clearPermissionLogs(): void {
  permissionLogs.length = 0;
}

// ============================================================================
// 自定义 canUseTool 实现
// ============================================================================

/**
 * 创建自定义 canUseTool 回调
 *
 * 演示如何实现自定义权限控制逻辑。
 * 这个函数返回一个符合 SDK CanUseTool 类型的回调函数。
 *
 * @param config 权限配置
 * @param onLog 日志回调（可选）
 * @returns canUseTool 回调函数
 *
 * @example
 * ```typescript
 * const canUseTool = createCustomCanUseTool(config, (entry) => {
 *   console.log(`[权限] ${entry.toolName} - ${entry.decision}`);
 * });
 *
 * query({
 *   prompt: 'hello',
 *   options: { canUseTool }
 * });
 * ```
 */
export function createCustomCanUseTool(
  config: PermissionConfig,
  onLog?: (entry: PermissionLogEntry) => void
): (
  toolName: string,
  input: Record<string, unknown>,
  options: CanUseToolOptions
) => Promise<PermissionResult> {
  return async (
    toolName: string,
    input: Record<string, unknown>,
    options: CanUseToolOptions
  ): Promise<PermissionResult> => {
    const entry: PermissionLogEntry = {
      timestamp: new Date(),
      toolName,
      toolUseId: options.toolUseID,
      input,
      source: 'canUseTool',
      decision: 'allow',
      suggestions: options.suggestions,
      blockedPath: options.blockedPath,
    };

    // 检查是否在拒绝列表
    if (config.deniedTools.includes(toolName)) {
      entry.decision = 'deny';
      entry.reason = `工具 "${toolName}" 在拒绝列表中`;
      addPermissionLog(entry);
      onLog?.(entry);
      return {
        behavior: 'deny',
        message: `工具 "${toolName}" 已被配置为拒绝执行`,
        toolUseID: options.toolUseID,
      };
    }

    // 检查是否在自动允许列表
    if (config.autoAllowedTools.includes(toolName)) {
      entry.decision = 'allow';
      entry.reason = `工具 "${toolName}" 在自动允许列表中`;
      addPermissionLog(entry);
      onLog?.(entry);
      return {
        behavior: 'allow',
        toolUseID: options.toolUseID,
      };
    }

    // 其他工具：根据决策原因提供信息
    if (options.decisionReason) {
      entry.reason = `SDK 决策原因: ${options.decisionReason}`;
    } else {
      entry.reason = '默认允许（不在拒绝或允许列表中）';
    }

    entry.decision = 'allow';
    addPermissionLog(entry);
    onLog?.(entry);

    return {
      behavior: 'allow',
      toolUseID: options.toolUseID,
    };
  };
}

// ============================================================================
// PreToolUse Hook 实现
// ============================================================================

/**
 * 创建 PreToolUse Hook 回调
 *
 * 演示如何使用 Hook 拦截工具调用。
 * PreToolUse Hook 在工具执行前被调用，可以：
 * 1. 修改工具输入参数
 * 2. 决定是否允许执行
 * 3. 添加额外上下文
 *
 * @param config 权限配置
 * @param onLog 日志回调（可选）
 * @returns Hook 回调函数
 *
 * @example
 * ```typescript
 * const hooks = {
 *   PreToolUse: [{
 *     hooks: [createPreToolUseHook(config, onLog)]
 *   }]
 * };
 *
 * query({
 *   prompt: 'hello',
 *   options: { hooks }
 * });
 * ```
 */
export function createPreToolUseHook(
  config: PermissionConfig,
  onLog?: (entry: PermissionLogEntry) => void
): (
  input: HookInput,
  toolUseID: string | undefined,
  options: { signal: AbortSignal }
) => Promise<HookJSONOutput> {
  return async (
    input: HookInput,
    _toolUseID: string | undefined,
    _options: { signal: AbortSignal }
  ): Promise<HookJSONOutput> => {
    // 类型守卫：确保是 PreToolUse 事件
    if (input.hook_event_name !== 'PreToolUse') {
      return { continue: true };
    }

    const preToolInput = input as PreToolUseHookInput;

    const entry: PermissionLogEntry = {
      timestamp: new Date(),
      toolName: preToolInput.tool_name,
      toolUseId: preToolInput.tool_use_id,
      input: preToolInput.tool_input as Record<string, unknown>,
      source: 'PreToolUseHook',
      decision: 'allow',
    };

    // 检查是否在拒绝列表
    if (config.deniedTools.includes(preToolInput.tool_name)) {
      entry.decision = 'deny';
      entry.reason = `Hook 拒绝: 工具 "${preToolInput.tool_name}" 在拒绝列表中`;
      addPermissionLog(entry);
      onLog?.(entry);

      const specificOutput: PreToolUseHookSpecificOutput = {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `工具 "${preToolInput.tool_name}" 已被 Hook 拒绝`,
      };

      return {
        continue: false,
        hookSpecificOutput: specificOutput,
      };
    }

    // 检查是否在自动允许列表
    if (config.autoAllowedTools.includes(preToolInput.tool_name)) {
      entry.decision = 'allow';
      entry.reason = `Hook 允许: 工具 "${preToolInput.tool_name}" 在自动允许列表中`;
    } else {
      entry.decision = 'allow';
      entry.reason = 'Hook 允许执行';
    }

    addPermissionLog(entry);
    onLog?.(entry);

    const specificOutput: PreToolUseHookSpecificOutput = {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      additionalContext: `[Playground Hook] 允许执行工具: ${preToolInput.tool_name}`,
    };

    return {
      continue: true,
      hookSpecificOutput: specificOutput,
    };
  };
}

// ============================================================================
// Hook 配置构建器
// ============================================================================

/**
 * 构建 Hook 配置
 *
 * 根据权限配置创建 SDK 需要的 hooks 选项
 *
 * @param config 权限配置
 * @param onLog 日志回调
 * @returns SDK hooks 配置对象，如果未启用则返回 undefined
 *
 * @example
 * ```typescript
 * const hooks = buildHooksConfig(config, (entry) => {
 *   console.log(`[Hook] ${entry.toolName} - ${entry.decision}`);
 * });
 *
 * query({
 *   prompt: 'hello',
 *   options: { hooks }
 * });
 * ```
 */
export function buildHooksConfig(
  config: PermissionConfig,
  onLog?: (entry: PermissionLogEntry) => void
): Partial<Record<HookEvent, HookCallbackMatcher[]>> | undefined {
  if (!config.enablePreToolUseHook) {
    return undefined;
  }

  return {
    PreToolUse: [
      {
        hooks: [createPreToolUseHook(config, onLog)],
      },
    ],
  };
}

// ============================================================================
// 权限日志格式化
// ============================================================================

/**
 * 格式化权限决策图标
 */
export function getDecisionIcon(decision: 'allow' | 'deny' | 'ask'): string {
  switch (decision) {
    case 'allow':
      return '✅';
    case 'deny':
      return '❌';
    case 'ask':
      return '❓';
  }
}

/**
 * 格式化权限日志条目为可读字符串
 */
export function formatPermissionLogEntry(entry: PermissionLogEntry): string {
  const time = entry.timestamp.toLocaleTimeString();
  const icon = getDecisionIcon(entry.decision);
  const lines: string[] = [
    `[${time}] ${icon} ${entry.toolName} (${entry.source})`,
  ];

  if (entry.reason) {
    lines.push(`  原因: ${entry.reason}`);
  }

  if (entry.blockedPath) {
    lines.push(`  阻止路径: ${entry.blockedPath}`);
  }

  return lines.join('\n');
}
