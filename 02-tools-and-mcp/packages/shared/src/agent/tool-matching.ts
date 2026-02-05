/**
 * 无状态工具匹配：SDK 消息 → AgentEvent 转换
 *
 * 本模块从 SDK 消息内容块中提取 tool_start 和 tool_result 事件，
 * 使用关联 ID 模式（Correlation ID Pattern）直接匹配，而非 FIFO 队列。
 *
 * 核心原则：所有输出仅依赖当前消息 + 只追加的工具索引。
 * 无可变队列、栈或依赖顺序的状态。
 */

import type { AgentEvent } from './agent-event';

// ============================================================================
// 工具索引 — 只追加、顺序无关的查找表
// ============================================================================

export interface ToolEntry {
  name: string;
  input: Record<string, unknown>;
}

/**
 * 只追加的工具元数据索引，从 tool_start 事件构建。
 * 顺序无关：先插入 A 再插入 B = 先插入 B 再插入 A。
 * 用于处理 tool_result 块时查找工具名称/输入
 * （tool_result 只携带 tool_use_id，不携带 tool_name）。
 */
export class ToolIndex {
  private entries = new Map<string, ToolEntry>();

  /** 注册工具（幂等操作 — 相同 ID 始终映射到相同条目） */
  register(toolUseId: string, name: string, input: Record<string, unknown>): void {
    // 如果现在有更完整的数据则更新 input（流式事件开始时 input 为空）
    const existing = this.entries.get(toolUseId);
    if (existing && Object.keys(existing.input).length === 0 && Object.keys(input).length > 0) {
      this.entries.set(toolUseId, { name, input });
    } else if (!existing) {
      this.entries.set(toolUseId, { name, input });
    }
  }

  getName(toolUseId: string): string | undefined {
    return this.entries.get(toolUseId)?.name;
  }

  getInput(toolUseId: string): Record<string, unknown> | undefined {
    return this.entries.get(toolUseId)?.input;
  }

  getEntry(toolUseId: string): ToolEntry | undefined {
    return this.entries.get(toolUseId);
  }

  has(toolUseId: string): boolean {
    return this.entries.has(toolUseId);
  }

  get size(): number {
    return this.entries.size;
  }
}

// ============================================================================
// 内容块类型（我们需要的 Anthropic SDK 类型子集）
// ============================================================================

/** 表示 assistant 消息中的 tool_use 内容块 */
export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** 表示 user 消息中的 tool_result 内容块 */
export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content?: unknown;
  is_error?: boolean;
}

/** 表示文本内容块 */
export interface TextBlock {
  type: 'text';
  text: string;
}

/** 我们处理的内容块联合类型 */
export type ContentBlock = ToolUseBlock | ToolResultBlock | TextBlock | { type: string };

// ============================================================================
// 纯提取函数
// ============================================================================

/**
 * 从 assistant 消息内容块中提取 tool_start 事件。
 *
 * 内容中的每个 tool_use 块都会转换为一个 tool_start 事件。
 *
 * @param contentBlocks - 来自 SDKAssistantMessage.message.content 的内容块
 * @param toolIndex - 用于注册新工具的只追加索引
 * @param emittedToolStartIds - 已发出的工具 ID 集合（用于流式/assistant 去重）
 * @param turnId - 当前轮次关联 ID
 * @returns tool_start AgentEvent 数组
 */
export function extractToolStarts(
  contentBlocks: ContentBlock[],
  toolIndex: ToolIndex,
  emittedToolStartIds: Set<string>,
  turnId?: string,
): AgentEvent[] {
  const events: AgentEvent[] = [];

  for (const block of contentBlocks) {
    if (block.type !== 'tool_use') continue;
    const toolBlock = block as ToolUseBlock;

    // 注册到索引（幂等操作 — 同时处理流式和 assistant 事件）
    toolIndex.register(toolBlock.id, toolBlock.name, toolBlock.input);

    // 去重：stream_event 在 assistant message 之前到达，两者包含相同的 tool_use 块。
    // Set 是只追加且顺序无关的（相同 ID 始终以相同方式去重）。
    if (emittedToolStartIds.has(toolBlock.id)) {
      // 已通过流式发出 — 但检查是否现在有完整的 input
      const hasNewInput = Object.keys(toolBlock.input).length > 0;
      if (hasNewInput) {
        // 使用完整 input 重新发出（assistant message 有完整 input，流式只有 {}）
        const intent = extractIntent(toolBlock);
        const displayName = toolBlock.input._displayName as string | undefined;
        events.push({
          type: 'tool_start',
          toolName: toolBlock.name,
          toolUseId: toolBlock.id,
          input: toolBlock.input,
          intent,
          displayName,
          turnId,
        });
      }
      continue;
    }

    emittedToolStartIds.add(toolBlock.id);

    const intent = extractIntent(toolBlock);
    const displayName = toolBlock.input._displayName as string | undefined;

    events.push({
      type: 'tool_start',
      toolName: toolBlock.name,
      toolUseId: toolBlock.id,
      input: toolBlock.input,
      intent,
      displayName,
      turnId,
    });
  }

  return events;
}

/**
 * 从 user 消息内容块中提取 tool_result 事件。
 *
 * 每个 tool_result 内容块都携带明确的 `tool_use_id`，
 * 直接标识该结果属于哪个工具。无需 FIFO 匹配。
 *
 * 当内容块不包含 tool_result 条目时，回退到便捷字段 `tool_use_result`。
 *
 * @param contentBlocks - 来自 SDKUserMessage.message.content 的内容块（可能为空）
 * @param toolUseResultValue - SDK 消息的便捷字段 tool_use_result
 * @param toolIndex - 用于查找工具名称/输入的只读索引
 * @param turnId - 当前轮次关联 ID
 * @returns tool_result AgentEvent 数组
 */
export function extractToolResults(
  contentBlocks: ContentBlock[],
  toolUseResultValue: unknown,
  toolIndex: ToolIndex,
  turnId?: string,
): AgentEvent[] {
  const events: AgentEvent[] = [];

  // 主路径：直接从内容块中提取 tool_use_id
  const toolResultBlocks = contentBlocks.filter(
    (b): b is ToolResultBlock => b.type === 'tool_result'
  );

  if (toolResultBlocks.length > 0) {
    // 关联 ID 直接匹配 — 每个块明确标识其对应的工具
    for (const block of toolResultBlocks) {
      const toolUseId = block.tool_use_id;
      const entry = toolIndex.getEntry(toolUseId);

      const resultStr = serializeResult(block.content);
      const isError = block.is_error ?? isToolResultError(block.content);

      events.push({
        type: 'tool_result',
        toolUseId,
        toolName: entry?.name,
        result: resultStr,
        isError,
        input: entry?.input,
        turnId,
      });
    }
  } else if (toolUseResultValue !== undefined) {
    // 回退路径：当内容块不可用时使用便捷字段。
    // 生成合成 ID 以避免结果被静默丢弃。
    const toolUseId = `fallback-${turnId ?? 'unknown'}`;
    const entry = toolIndex.getEntry(toolUseId);

    const resultStr = serializeResult(toolUseResultValue);
    const isError = isToolResultError(toolUseResultValue);

    events.push({
      type: 'tool_result',
      toolUseId,
      toolName: entry?.name,
      result: resultStr,
      isError,
      input: entry?.input,
      turnId,
    });
  }

  return events;
}

// ============================================================================
// 辅助函数（纯函数）
// ============================================================================

/** 从 tool_use 块的 input 中提取意图描述 */
function extractIntent(toolBlock: ToolUseBlock): string | undefined {
  const input = toolBlock.input;
  if (!input || typeof input !== 'object') return undefined;

  // 检查常见的意图字段名
  if ('description' in input && typeof input.description === 'string') {
    return input.description;
  }
  if ('intent' in input && typeof input.intent === 'string') {
    return input.intent;
  }
  if ('prompt' in input && typeof input.prompt === 'string') {
    return input.prompt;
  }

  return undefined;
}

/**
 * 将工具结果转换为字符串。
 * 处理字符串、对象、数组和原始类型。
 */
export function serializeResult(result: unknown): string {
  if (result === null || result === undefined) {
    return '';
  }

  if (typeof result === 'string') {
    return result;
  }

  if (Array.isArray(result)) {
    // 处理内容块数组（Anthropic SDK 中常见）
    const textParts: string[] = [];
    for (const item of result) {
      if (typeof item === 'string') {
        textParts.push(item);
      } else if (item && typeof item === 'object' && 'text' in item) {
        textParts.push(String(item.text));
      } else if (item && typeof item === 'object' && 'type' in item && item.type === 'text' && 'text' in item) {
        textParts.push(String(item.text));
      }
    }
    if (textParts.length > 0) {
      return textParts.join('\n');
    }
    // 非文本数组回退到 JSON
    return JSON.stringify(result, null, 2);
  }

  if (typeof result === 'object') {
    // 检查文本内容块
    if ('text' in result) {
      return String(result.text);
    }
    if ('type' in result && result.type === 'text' && 'text' in result) {
      return String(result.text);
    }
    // 回退到 JSON
    return JSON.stringify(result, null, 2);
  }

  // 原始类型
  return String(result);
}

/**
 * 检查工具结果是否表示错误。
 * 查找字符串结果中的 "Error:" 前缀。
 */
export function isToolResultError(result: unknown): boolean {
  const resultStr = serializeResult(result);
  return resultStr.trimStart().startsWith('Error:');
}
