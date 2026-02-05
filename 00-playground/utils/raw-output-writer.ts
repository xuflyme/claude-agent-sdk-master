/**
 * 原始输出写入模块
 *
 * 管理原始 JSON 输出的文件写入，支持 NDJSON 格式。
 * NDJSON (Newline Delimited JSON) 每行一条 JSON，方便流式处理和分析。
 */

import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

/**
 * 生成带时间戳的文件名
 * 格式: YYYY-MM-DD_HHmmss.ndjson
 */
function generateOutputFileName(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day}_${hours}${minutes}${seconds}.ndjson`;
}

/**
 * 确保输出目录存在
 */
function ensureOutputDirectory(baseDir: string): string {
  const outputDir = join(baseDir, 'output');
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }
  return outputDir;
}

/**
 * 原始输出写入器类
 *
 * 用于将 SDK 消息写入 NDJSON 文件。
 * 每次查询创建一个新的文件会话。
 */
export class RawOutputWriter {
  private filePath: string | null = null;
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  /**
   * 初始化新的输出会话
   * 创建新的 NDJSON 文件
   * @returns 文件完整路径
   */
  startSession(): string {
    const outputDir = ensureOutputDirectory(this.baseDir);
    const fileName = generateOutputFileName();
    this.filePath = join(outputDir, fileName);
    return this.filePath;
  }

  /**
   * 写入一条 SDK 消息到文件
   * @param msg SDK 消息对象
   */
  writeMessage(msg: SDKMessage): void {
    if (!this.filePath) {
      throw new Error('Output session not started. Call startSession() first.');
    }

    const compactJson = JSON.stringify(msg);
    appendFileSync(this.filePath, compactJson + '\n', 'utf-8');
  }

  /**
   * 结束当前会话
   */
  endSession(): void {
    this.filePath = null;
  }

  /**
   * 获取当前文件路径
   */
  getCurrentFilePath(): string | null {
    return this.filePath;
  }
}
