# Claude Agent SDK 系列教程 - 第三章：Agent 权限控制

> **教程定位**
> 本教程是 **Claude Agent SDK 系列教程的第三部分**，基于第二章的架构，深入探讨如何实现 Agent 的权限管理与安全控制。

## 📖 系列教程路线图

本系列采用**渐进式学习路径**，每一章都在前一章的基础上递进：

- **第一章**：快速入门 - 核心概念与基础对话 ✅
- **第二章**：工具调用 - 集成 MCP Tools，实现 Agent 能力 ✅
- **第三章（本章）**：权限控制 - Agent 权限管理与安全控制 ⏳
- **第四章**：高级特性 - 自定义系统提示、成本追踪、流式优化

## 💡 设计哲学

**软件的本质，归根结底是对状态的优雅处理。**

无论是 Claude Agent SDK 的会话状态、React 的组件状态，还是未来的 Proma 开源项目，核心都是如何优雅地管理和转换状态。本系列教程将这一理念贯穿始终，帮助你建立系统化的思维模型。

> **✨ 关于本教程**
> 本教程的大部分内容由 Claude Code 编写而成。每个项目都配有详尽的 `CLAUDE.md` 文档作为开发指引。我强烈建议你在学习的基础上进行实验和改动——**实践是最好的老师**。

---

## 🎓 第三章学习目标

完成本章后，你将掌握：

1. **Agent 权限控制机制**
   - 理解 SDK 的 `canUseTool` 回调与 `PermissionMode`
   - 实现交互式工具权限审批（Allow / Deny / Always Allow）
   - 处理 `PermissionResult` 的 `updatedInput` 机制

2. **AskUserQuestion 问答交互**
   - 理解 AskUserQuestion 作为特殊工具的权限流程
   - 实现专用问答 UI（单选/多选/自定义输入）
   - 通过 `updatedInput.answers` 回传用户答案给 SDK

3. **跨 Route 异步状态管理**
   - 使用 Promise + SSE 实现跨请求的异步等待
   - 解决 Next.js App Router 模块隔离问题（`globalThis` 模式）
   - 处理 AbortSignal 防止 Promise 泄漏

> **⚠️ 前置要求**
> 本章假设你已经完成第二章的学习，理解了 PromaAgent 事件驱动架构、工具活动可视化和 Monorepo 结构。

---

## ⚡ 快速开始

### 前置要求

- Node.js 18+
- pnpm 包管理器
- Anthropic API Key（[获取地址](https://console.anthropic.com/)）

### 三步启动

**1️⃣ 安装依赖**

```bash
pnpm install
```

**2️⃣ 配置 API Key**

```bash
cp .env.local.example .env.local
# 编辑 .env.local，填入你的 API Key
```

**3️⃣ 启动开发服务器**

```bash
pnpm dev
```

访问 [http://localhost:3000](http://localhost:3000)，发送需要工具调用的消息（如 "读取当前目录的文件列表"），即可看到权限选择器。

---

## ✨ 项目特性

| 特性 | 说明 | 技术实现 |
|------|------|----------|
| 🛡️ **交互式权限审批** | Agent 调用工具前需用户确认 | `canUseTool` + SSE + Promise |
| ❓ **AskUserQuestion 问答** | Agent 向用户提问，渲染专用表单 | 单选/多选/自定义输入 + `updatedInput` |
| 🔄 **流式对话** | 实时展示 Claude 的响应 | Server-Sent Events (SSE) |
| 🔧 **工具活动可视化** | 实时追踪工具调用生命周期 | ToolActivityManager + AgentEvent |
| 📝 **会话管理** | 自动保存和加载历史对话 | JSONL 格式本地存储 |
| 📁 **文件浏览** | 浏览工作目录，预览文件内容 | 文件系统 API |
| 🎨 **Markdown 渲染** | 代码高亮、表格、列表等完整支持 | react-markdown + highlight.js |

---

## 🏗️ 权限系统架构

本章的核心创新是基于 SSE + Promise 的异步权限控制系统。

### 完整数据流

```
SDK canUseTool(toolName, input, options)
       ↓
创建 Promise + 存 resolver 到 globalThis Map
       ↓
SSE 发送 permission_request 事件到前端
       ↓
前端渲染 PermissionSelector
  ├── 通用工具 → Allow / Deny / Always Allow 按钮
  └── AskUserQuestion → 专用问答表单（单选/多选/Other）
       ↓
用户操作 → POST /api/chat/permission
       ↓
查找 resolver → resolve Promise → SDK 继续执行
```

### 关键文件

| 文件 | 职责 |
|------|------|
| `packages/shared/src/agent/proma-agent.ts` | 支持 `canUseTool` 回调和动态 `permissionMode` |
| `lib/permission-store.ts` | 基于 `globalThis` 的 Promise resolver 存储 |
| `app/api/chat/route.ts` | 创建 `canUseTool` 闭包，通过 SSE 发送权限请求 |
| `app/api/chat/permission/route.ts` | 接收用户决策，resolve 对应 Promise |
| `components/permission-selector.tsx` | 前端权限 UI（通用选择器 + AskUserQuestion 表单） |

### 权限模式自动选择

```typescript
// PromaAgent 根据是否提供 canUseTool 自动选择权限模式
const permissionMode = config.permissionMode
  ?? (hasCanUseTool ? 'default' : 'bypassPermissions');
```

- 提供 `canUseTool` → `permissionMode: 'default'`（交互式审批）
- 未提供 → `permissionMode: 'bypassPermissions'`（跳过审批，向后兼容）

### AskUserQuestion 特殊处理

当 Agent 需要向用户提问时，SDK 会触发 `canUseTool('AskUserQuestion', input, options)`。前端检测到 `toolName === 'AskUserQuestion'` 后，渲染专用问答表单：

- 解析 `input.questions` 数组，渲染每个问题的选项
- 支持单选（radio）、多选（checkbox）和 "Other" 自定义文本输入
- 用户提交后，将 `answers: Record<string, string>` 合并到 `updatedInput` 回传给 SDK

```typescript
// AskUserQuestionForm 提交逻辑
const handleSubmit = () => {
  const updatedInput = { ...request.input, answers };
  onDecision(request.requestId, 'allow', undefined, updatedInput);
};
```

### globalThis 跨 Route 共享

Next.js App Router 中，`/api/chat` 和 `/api/chat/permission` 可能加载不同的模块实例，导致模块级变量不共享。使用 `globalThis` 解决：

```typescript
const STORE_KEY = '__permission_pending_store__';
function getStore(): Map<string, PendingPermission> {
  const g = globalThis as Record<string, unknown>;
  if (!g[STORE_KEY]) {
    g[STORE_KEY] = new Map<string, PendingPermission>();
  }
  return g[STORE_KEY] as Map<string, PendingPermission>;
}
```

### AbortSignal 清理

当用户点击停止或断开连接时，通过 AbortSignal 自动 resolve 挂起的 Promise，防止内存泄漏：

```typescript
if (options.signal) {
  options.signal.addEventListener('abort', () => {
    resolvePending(requestId, { behavior: 'deny', message: 'Request aborted' });
  }, { once: true });
}
```

---

## 📂 项目结构

```
03-agent-with-permission/
├── packages/
│   ├── core/                          # 📦 核心类型定义包
│   │   └── src/
│   │       ├── message.ts             # 消息类型
│   │       ├── session.ts             # 会话类型
│   │       ├── workspace.ts           # 工作空间配置
│   │       └── storage.ts             # 存储接口
│   │
│   └── shared/                        # 📦 共享 Agent 逻辑包
│       └── src/agent/
│           ├── agent-event.ts         # AgentEvent 类型（含 permission_request）
│           ├── proma-agent.ts         # PromaAgent（支持 canUseTool）
│           ├── tool-matching.ts       # 无状态工具匹配
│           └── options.ts             # Agent 配置选项
│
├── app/api/
│   ├── chat/
│   │   ├── route.ts                   # 聊天 API + canUseTool 闭包
│   │   └── permission/route.ts        # 🆕 权限决策 API
│   ├── sessions/                      # 会话管理 API
│   └── files/route.ts                 # 文件浏览 API
│
├── components/
│   ├── chat-interface.tsx             # 聊天 UI（集成权限选择器）
│   ├── permission-selector.tsx        # 🆕 权限请求 UI（通用 + AskUserQuestion）
│   ├── tool-activity-list.tsx         # 工具活动列表
│   ├── tool-activity-row.tsx          # 工具活动行
│   ├── tool-activity-icon.tsx         # 工具活动图标
│   ├── session-list.tsx               # 会话历史列表
│   ├── file-explorer.tsx              # 文件浏览器
│   └── markdown-renderer.tsx          # Markdown 渲染
│
├── lib/
│   ├── permission-store.ts            # 🆕 权限 Promise resolver 存储（globalThis）
│   ├── tool-activity.ts               # 工具活动管理器
│   ├── tool-display.ts                # 工具显示逻辑
│   ├── tool-icon-config.ts            # 工具图标配置
│   └── storage/                       # 本地存储实现
│
└── .data/                             # 数据存储（gitignored）
```

---

## 🛠️ 技术栈

| 类别 | 技术选型 | 版本 |
|------|----------|------|
| **框架** | Next.js (App Router) | 16.1.6 |
| **UI 库** | React | 19.2.3 |
| **类型系统** | TypeScript (strict) | 5.x |
| **样式方案** | Tailwind CSS | 4.x |
| **组件库** | Shadcn UI | - |
| **AI SDK** | Claude Agent SDK | 0.2.29 |
| **动画** | framer-motion | 12.30.0 |
| **Markdown** | react-markdown + highlight.js | - |
| **包管理器** | pnpm (Workspace) | - |

---

## 📚 详细文档

想了解完整的实现细节？查看 [CLAUDE.md](./CLAUDE.md) 获取：

- 完整的架构设计说明
- PromaAgent 事件驱动架构详解
- 权限系统的完整实现细节
- 工具活动可视化系统
- API Routes 的详细文档

---

## 🚀 下一步

完成本章学习后，你可以：

1. **🔧 实验改造**
   - 实现 "Always Allow" 的持久化存储
   - 添加权限规则引擎（基于工具名自动审批）
   - 为 AskUserQuestion 添加更多输入类型

2. **📖 继续学习**
   - 第四章：高级特性 - 自定义系统提示、成本追踪、流式优化

3. **💡 探索 SDK**
   - 阅读 [Claude Agent SDK 官方文档](https://platform.claude.com/docs/en/agent-sdk/typescript)
   - 研究 `PermissionMode` 和 `CanUseTool` 的更多用法

---

## 🔗 相关资源

- [Claude Agent SDK 文档](https://platform.claude.com/docs/en/agent-sdk/typescript) - 官方 SDK 文档
- [Next.js 文档](https://nextjs.org/docs) - Next.js App Router 指南
- [Shadcn UI](https://ui.shadcn.com) - UI 组件库文档
- [Tailwind CSS](https://tailwindcss.com/docs) - 样式框架文档

---

## 📄 License

MIT License - 自由使用，欢迎改进和分享

---

<p align="center">
  <i>这个项目由 Claude Code 协助创建 ✨</i><br>
  <i>如果对你有帮助，欢迎 Star ⭐️</i>
</p>
