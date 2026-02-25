/**
 * Claude Agent SDK Playground
 *
 * 交互式测试 SDK 的 query 函数。
 * 启动后可以直接输入提示词进行测试，支持配置工具、详细模式等。
 *
 * 使用方法:
 *   1. 复制 .env.example 为 .env.local 并填写 API Key
 *   2. 运行: pnpm play
 *   3. 按提示输入或直接回车使用默认值
 */

import { config } from 'dotenv';
import { resolve } from 'path';

// 加载环境变量 (.env.local 优先，然后 .env)
config({ path: resolve(process.cwd(), '.env.local') });
config({ path: resolve(process.cwd(), '.env') });

import { query, type SDKMessage, type PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import { type PlaygroundConfig } from './lib/config.js';
import { interactiveLoop } from './lib/cli.js';
import { printSeparator, printSDKMessage, printRawSDKMessage } from './utils/printer.js';
import { RawOutputWriter } from './utils/raw-output-writer.js';
import {
  createCustomCanUseTool,
  buildHooksConfig,
  type PermissionLogEntry,
} from './lib/permissions.js';

// ============================================================================
// 核心查询执行 - SDK 使用示例
// ============================================================================

/**
 * 执行 SDK 查询
 *
 * 这是使用 Claude Agent SDK 的核心代码。
 * 用户可以在这里修改配置来测试不同的 SDK 功能。
 */
async function executeQuery(cfg: PlaygroundConfig): Promise<void> {
  printSeparator('SDK 消息');

  // 初始化原始输出写入器（如果启用）
  let rawWriter: RawOutputWriter | null = null;
  if (cfg.rawOutput) {
    rawWriter = new RawOutputWriter(process.cwd());
    const filePath = rawWriter.startSession();
    console.log(`📁 原始输出将写入: ${filePath}`);
  }

  // ========================================
  // 🔧 工具配置 - 可以在这里修改
  // ========================================
  const toolsConfig = cfg.enableTools
    ? { type: 'preset' as const, preset: 'claude_code' as const }
    : [];

  // ========================================
  // 🌍 环境变量配置
  // ========================================
  const envConfig: Record<string, string | undefined> = {
    ...process.env,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  };

  if (process.env.ANTHROPIC_BASE_URL) {
    envConfig.ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL;
  }

  // ========================================
  // 🔐 权限配置
  // ========================================

  // 权限日志回调
  const onPermissionLog = (entry: PermissionLogEntry): void => {
    if (cfg.permission.verbosePermissionLog) {
      const icon = entry.decision === 'allow' ? '✅' : '❌';
      console.log(`\n${icon} [权限] ${entry.toolName} - ${entry.decision}`);
      if (entry.reason) {
        console.log(`   原因: ${entry.reason}`);
      }
    }
  };

  // 构建 canUseTool 回调（如果启用）
  const canUseTool = cfg.permission.enableCustomCanUseTool
    ? createCustomCanUseTool(cfg.permission, onPermissionLog)
    : undefined;

  // 构建 hooks 配置（如果启用）
  const hooks = buildHooksConfig(cfg.permission, onPermissionLog);

  // 确定权限模式和安全标志
  const permissionMode: PermissionMode = cfg.permission.mode;
  const allowDangerouslySkipPermissions = permissionMode === 'bypassPermissions';

  // ========================================
  // 📝 查询配置 - SDK 核心参数
  // ========================================
  const queryConfig = {
    prompt: cfg.prompt,
    options: {
      cwd: cfg.workingDirectory,
      includePartialMessages: true,
      permissionMode,
      allowDangerouslySkipPermissions,
      tools: toolsConfig,
      env: envConfig,
      // 条件添加自定义回调
      ...(canUseTool && { canUseTool }),
      ...(hooks && { hooks }),
    },
  };

  // 显示当前权限配置摘要
  if (cfg.permission.verbosePermissionLog) {
    console.log(`\n🔐 权限模式: ${permissionMode}`);
    if (canUseTool) console.log('   自定义 canUseTool: 启用');
    if (hooks) console.log('   PreToolUse Hook: 启用');
    console.log('');
  }

  // ========================================
  // 🚀 执行查询并处理流式响应
  // ========================================
  const messages = query(queryConfig) as AsyncIterable<SDKMessage>;

  let messageIndex = 0;
  let textBuffer = '';

  for await (const msg of messages) {
    // 原始模式：打印美化 JSON 并写入文件
    if (cfg.rawOutput) {
      printRawSDKMessage(msg, messageIndex);
      rawWriter?.writeMessage(msg);
    } else {
      // 正常模式：使用现有打印逻辑
      printSDKMessage(msg, messageIndex, cfg);
    }

    messageIndex++;

    // 收集最终文本
    if (msg.type === 'assistant' && msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === 'text' && block.text) {
          textBuffer = block.text;
        }
      }
    }
  }

  // 结束原始输出会话
  if (rawWriter) {
    rawWriter.endSession();
    console.log(`\n📁 原始输出已保存`);
  }

  // 非流式模式下显示完整回复
  if (textBuffer && !cfg.streamText) {
    printSeparator('最终回复');
    console.log(textBuffer);
  }

  printSeparator('完成');
}

// ============================================================================
// 入口
// ============================================================================

async function main(): Promise<void> {
  // 检查 API Key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ 错误: 未设置 ANTHROPIC_API_KEY 环境变量');
    console.error('   请在 .env.local 中设置');
    process.exit(1);
  }

  await interactiveLoop(executeQuery);
}

main().catch((error) => {
  console.error('❌ Playground 错误:', error);
  process.exit(1);
});
