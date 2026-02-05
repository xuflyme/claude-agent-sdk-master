/**
 * 交互式命令行模块
 *
 * 提供命令行交互界面、用户输入处理、命令解析等功能。
 */

import * as readline from 'readline';
import { currentConfig, type PlaygroundConfig } from './config.js';
import {
  PERMISSION_MODE_DESCRIPTIONS,
  getPermissionLogs,
  clearPermissionLogs,
  formatPermissionLogEntry,
  getDecisionIcon,
} from './permissions.js';
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';

// ============================================================================
// Readline 工具
// ============================================================================

/** 创建 readline 接口 */
export function createReadline(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

/** 提示用户输入，支持默认值 */
export async function prompt(
  rl: readline.Interface,
  question: string,
  defaultValue?: string
): Promise<string> {
  const defaultHint = defaultValue !== undefined ? ` [${defaultValue}]` : '';
  return new Promise((resolve) => {
    rl.question(`${question}${defaultHint}: `, (answer) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

/** 提示用户输入是/否 */
export async function promptYesNo(
  rl: readline.Interface,
  question: string,
  defaultValue: boolean
): Promise<boolean> {
  const defaultHint = defaultValue ? '[Y/n]' : '[y/N]';
  return new Promise((resolve) => {
    rl.question(`${question} ${defaultHint}: `, (answer) => {
      const a = answer.trim().toLowerCase();
      if (a === '') {
        resolve(defaultValue);
      } else {
        resolve(a === 'y' || a === 'yes' || a === '是');
      }
    });
  });
}

// ============================================================================
// 配置显示
// ============================================================================

/** 显示当前配置 */
export function showCurrentConfig(): void {
  console.log('\n📋 当前配置:');
  console.log(`  启用工具: ${currentConfig.enableTools ? '是' : '否'}`);
  console.log(`  详细模式: ${currentConfig.verbose ? '是' : '否'}`);
  console.log(`  展开内容块: ${currentConfig.expandContent ? '是' : '否'}`);
  console.log(`  显示原始 JSON: ${currentConfig.showRawJson ? '是' : '否'}`);
  console.log(`  流式输出: ${currentConfig.streamText ? '是' : '否'}`);
  console.log(`  原始输出模式: ${currentConfig.rawOutput ? '是' : '否'}`);
  console.log(`  工作目录: ${currentConfig.workingDirectory}`);
  console.log(`  API Base URL: ${process.env.ANTHROPIC_BASE_URL || '(默认)'}`);
  showPermissionConfig();
}

/** 显示权限配置 */
export function showPermissionConfig(): void {
  const perm = currentConfig.permission;
  console.log('\n🔐 权限配置:');
  console.log(`  权限模式: ${perm.mode} - ${PERMISSION_MODE_DESCRIPTIONS[perm.mode]}`);
  console.log(`  自定义 canUseTool: ${perm.enableCustomCanUseTool ? '启用' : '禁用'}`);
  console.log(`  PreToolUse Hook: ${perm.enablePreToolUseHook ? '启用' : '禁用'}`);
  console.log(`  详细权限日志: ${perm.verbosePermissionLog ? '启用' : '禁用'}`);
  console.log(`  自动允许工具: ${perm.autoAllowedTools.join(', ') || '(无)'}`);
  console.log(`  拒绝工具: ${perm.deniedTools.join(', ') || '(无)'}`);
}

/** 显示帮助信息 */
export function showHelp(): void {
  console.log(`
📚 可用命令:
  /config   - 修改配置选项
  /show     - 显示当前配置
  /tools    - 切换工具启用状态
  /verbose  - 切换详细模式
  /expand   - 切换展开内容块
  /json     - 切换原始 JSON 显示
  /stream   - 切换流式输出
  /raw      - 切换原始输出模式 (美化 JSON + NDJSON 文件)

🔐 权限命令:
  /perm       - 打开权限配置菜单
  /perm-show  - 显示当前权限配置
  /perm-mode  - 快速切换权限模式
  /perm-log   - 查看权限日志

  /help     - 显示此帮助
  /quit     - 退出程序

💡 提示:
  - 直接输入文本发送给 Claude
  - 回车使用默认配置快速测试
  - Ctrl+C 中断当前操作
`);
}

/** 修改配置 */
export async function modifyConfig(rl: readline.Interface): Promise<void> {
  console.log('\n⚙️  修改配置 (直接回车保持当前值):');

  currentConfig.enableTools = await promptYesNo(rl, '启用工具?', currentConfig.enableTools);
  currentConfig.verbose = await promptYesNo(rl, '详细模式?', currentConfig.verbose);
  currentConfig.expandContent = await promptYesNo(rl, '展开内容块?', currentConfig.expandContent);
  currentConfig.showRawJson = await promptYesNo(rl, '显示原始 JSON?', currentConfig.showRawJson);
  currentConfig.streamText = await promptYesNo(rl, '流式输出?', currentConfig.streamText);
  currentConfig.rawOutput = await promptYesNo(rl, '原始输出模式?', currentConfig.rawOutput);

  const newCwd = await prompt(rl, '工作目录', currentConfig.workingDirectory);
  if (newCwd) {
    currentConfig.workingDirectory = newCwd;
  }

  console.log('\n✅ 配置已更新');
  showCurrentConfig();
}

// ============================================================================
// 权限配置
// ============================================================================

/** 选择权限模式 */
export async function selectPermissionMode(rl: readline.Interface): Promise<void> {
  console.log('\n🔐 选择权限模式:\n');

  const modes: PermissionMode[] = [
    'default',
    'acceptEdits',
    'bypassPermissions',
    'plan',
    'delegate',
    'dontAsk',
  ];

  modes.forEach((mode, index) => {
    const current = currentConfig.permission.mode === mode ? ' (当前)' : '';
    console.log(`  ${index + 1}. ${mode}${current}`);
    console.log(`     ${PERMISSION_MODE_DESCRIPTIONS[mode]}`);
  });

  console.log('\n  0. 取消');

  const answer = await prompt(rl, '\n选择 (0-6)', '0');
  const choice = parseInt(answer, 10);

  if (choice >= 1 && choice <= modes.length) {
    const selectedMode = modes[choice - 1];
    currentConfig.permission.mode = selectedMode;
    console.log(`\n✅ 权限模式已设置为: ${selectedMode}`);

    // 如果选择 bypassPermissions，提示安全警告
    if (selectedMode === 'bypassPermissions') {
      console.log('⚠️  注意: bypassPermissions 模式会跳过所有权限检查');
    }
  } else {
    console.log('已取消');
  }
}

/** 管理工具列表 */
async function manageToolList(
  rl: readline.Interface,
  listKey: 'autoAllowedTools' | 'deniedTools',
  listName: string
): Promise<void> {
  const list = currentConfig.permission[listKey];
  console.log(`\n当前${listName}工具: ${list.length > 0 ? list.join(', ') : '(空)'}`);
  console.log('\n  1. 添加工具');
  console.log('  2. 移除工具');
  console.log('  3. 重置为默认');
  console.log('  0. 返回');

  const choice = await prompt(rl, '选择', '0');

  if (choice === '1') {
    const toolName = await prompt(rl, '输入工具名称 (如 Bash, Write, Edit)');
    if (toolName && !list.includes(toolName)) {
      list.push(toolName);
      console.log(`已添加: ${toolName}`);
    } else if (list.includes(toolName)) {
      console.log(`工具 "${toolName}" 已在列表中`);
    }
  } else if (choice === '2') {
    const toolName = await prompt(rl, '输入要移除的工具名称');
    const index = list.indexOf(toolName);
    if (index > -1) {
      list.splice(index, 1);
      console.log(`已移除: ${toolName}`);
    } else {
      console.log(`工具 "${toolName}" 不在列表中`);
    }
  } else if (choice === '3') {
    if (listKey === 'autoAllowedTools') {
      currentConfig.permission[listKey] = ['Read', 'Glob', 'Grep'];
    } else {
      currentConfig.permission[listKey] = [];
    }
    console.log(`已重置${listName}工具列表`);
  }
}

/** 显示权限日志 */
function showPermissionLogs(): void {
  const logs = getPermissionLogs();
  if (logs.length === 0) {
    console.log('\n(暂无权限日志)');
    return;
  }

  console.log(`\n📋 权限日志 (共 ${logs.length} 条):\n`);
  logs.forEach((log, index) => {
    const icon = getDecisionIcon(log.decision);
    console.log(`${index + 1}. ${icon} ${formatPermissionLogEntry(log)}`);
    console.log('');
  });
}

/** 权限配置菜单 */
export async function modifyPermissionConfig(rl: readline.Interface): Promise<void> {
  console.log('\n🔐 权限配置菜单:\n');
  console.log('  1. 选择权限模式');
  console.log('  2. 切换自定义 canUseTool 回调');
  console.log('  3. 切换 PreToolUse Hook');
  console.log('  4. 切换详细权限日志');
  console.log('  5. 管理自动允许工具列表');
  console.log('  6. 管理拒绝工具列表');
  console.log('  7. 查看权限日志');
  console.log('  8. 清空权限日志');
  console.log('  0. 返回');

  const answer = await prompt(rl, '\n选择 (0-8)', '0');

  switch (answer) {
    case '1':
      await selectPermissionMode(rl);
      break;
    case '2':
      currentConfig.permission.enableCustomCanUseTool =
        !currentConfig.permission.enableCustomCanUseTool;
      console.log(
        `自定义 canUseTool 已${currentConfig.permission.enableCustomCanUseTool ? '启用' : '禁用'}`
      );
      break;
    case '3':
      currentConfig.permission.enablePreToolUseHook =
        !currentConfig.permission.enablePreToolUseHook;
      console.log(
        `PreToolUse Hook 已${currentConfig.permission.enablePreToolUseHook ? '启用' : '禁用'}`
      );
      break;
    case '4':
      currentConfig.permission.verbosePermissionLog =
        !currentConfig.permission.verbosePermissionLog;
      console.log(
        `详细权限日志已${currentConfig.permission.verbosePermissionLog ? '启用' : '禁用'}`
      );
      break;
    case '5':
      await manageToolList(rl, 'autoAllowedTools', '自动允许');
      break;
    case '6':
      await manageToolList(rl, 'deniedTools', '拒绝');
      break;
    case '7':
      showPermissionLogs();
      break;
    case '8':
      clearPermissionLogs();
      console.log('权限日志已清空');
      break;
  }
}

// ============================================================================
// 交互式循环
// ============================================================================

/** 查询执行器类型 */
export type QueryExecutor = (cfg: PlaygroundConfig) => Promise<void>;

/** 主交互循环 */
export async function interactiveLoop(executeQuery: QueryExecutor): Promise<void> {
  const rl = createReadline();

  console.log('🚀 Claude Agent SDK Playground');
  console.log('━'.repeat(40));
  showCurrentConfig();
  console.log('\n输入 /help 查看帮助，或直接输入提示词开始测试\n');

  const promptUser = (): void => {
    rl.question('📝 输入提示词 (或命令): ', async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        // 空输入，使用默认提示词快速测试
        console.log('使用默认提示词: "你好！请用一句话介绍你自己。"');
        try {
          await executeQuery({
            ...currentConfig,
            prompt: '你好！请用一句话介绍你自己。',
          });
        } catch (error) {
          console.error('❌ 执行错误:', error);
        }
        promptUser();
        return;
      }

      // 处理命令
      if (trimmed.startsWith('/')) {
        const cmd = trimmed.toLowerCase();

        switch (cmd) {
          case '/quit':
          case '/exit':
          case '/q':
            console.log('\n👋 再见！');
            rl.close();
            process.exit(0);

          case '/help':
          case '/h':
            showHelp();
            break;

          case '/config':
            await modifyConfig(rl);
            break;

          case '/show':
            showCurrentConfig();
            break;

          case '/tools':
            currentConfig.enableTools = !currentConfig.enableTools;
            console.log(`工具已${currentConfig.enableTools ? '启用' : '禁用'}`);
            break;

          case '/verbose':
            currentConfig.verbose = !currentConfig.verbose;
            console.log(`详细模式已${currentConfig.verbose ? '开启' : '关闭'}`);
            break;

          case '/expand':
            currentConfig.expandContent = !currentConfig.expandContent;
            console.log(`展开内容块已${currentConfig.expandContent ? '开启' : '关闭'}`);
            break;

          case '/json':
            currentConfig.showRawJson = !currentConfig.showRawJson;
            console.log(`原始 JSON 显示已${currentConfig.showRawJson ? '开启' : '关闭'}`);
            break;

          case '/stream':
            currentConfig.streamText = !currentConfig.streamText;
            console.log(`流式输出已${currentConfig.streamText ? '开启' : '关闭'}`);
            break;

          case '/raw':
            currentConfig.rawOutput = !currentConfig.rawOutput;
            console.log(`原始输出模式已${currentConfig.rawOutput ? '开启' : '关闭'}`);
            if (currentConfig.rawOutput) {
              console.log('  提示: 下次查询时将同时输出美化 JSON 到终端，并写入 NDJSON 文件');
            }
            break;

          // 权限命令
          case '/perm':
          case '/permission':
            await modifyPermissionConfig(rl);
            break;

          case '/perm-show':
            showPermissionConfig();
            break;

          case '/perm-mode':
            await selectPermissionMode(rl);
            break;

          case '/perm-log':
            showPermissionLogs();
            break;

          default:
            console.log(`未知命令: ${cmd}，输入 /help 查看帮助`);
        }

        promptUser();
        return;
      }

      // 执行查询
      try {
        await executeQuery({
          ...currentConfig,
          prompt: trimmed,
        });
      } catch (error) {
        console.error('❌ 执行错误:', error);
      }

      promptUser();
    });
  };

  promptUser();
}
