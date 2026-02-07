/**
 * Web Chat Server — 类 LobeChat 的现代 AI 对话界面
 *
 * 提供完整的 Web Chat 体验：
 * - 实时对话（SSE 流式输出）
 * - 对话历史管理
 * - Agent 状态面板
 * - Skills / Memory / 任务监控
 * - 深色/浅色主题
 * - 移动端响应式
 *
 * 零依赖：仅 Node.js 内置 http 模块
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import type { AgentCore } from "../agent.js";
import type { VectorMemory } from "../memory/vector-store.js";
import type { AutonomousPlanner, TaskGoal } from "../autonomous/planner.js";
import type { KnowledgeBase } from "../knowledge/base.js";
import type { NotificationCenter } from "../notification/center.js";
import type { ConversationManager } from "../conversation/manager.js";
import type { LLMClient } from "../providers/llm.js";

export interface WebChatConfig {
  port: number;
  host?: string;
  title?: string;
}

export class WebChatServer {
  private agent: AgentCore;
  private vectorMemory?: VectorMemory;
  private planner?: AutonomousPlanner;
  private knowledgeBase?: KnowledgeBase;
  private notifications?: NotificationCenter;
  private convManager?: ConversationManager;
  private llmClient?: LLMClient;
  private config: WebChatConfig;
  private server?: ReturnType<typeof createServer>;

  /** SSE 连接池 */
  private sseClients: Set<ServerResponse> = new Set();

  /** 对话历史（内存版，优先使用 ConversationManager） */
  private conversations: Map<
    string,
    Array<{ role: "user" | "assistant" | "system"; content: string; timestamp: string }>
  > = new Map();

  constructor(
    agent: AgentCore,
    config?: Partial<WebChatConfig>,
    deps?: {
      vectorMemory?: VectorMemory;
      planner?: AutonomousPlanner;
      knowledgeBase?: KnowledgeBase;
      notifications?: NotificationCenter;
      convManager?: ConversationManager;
      llmClient?: LLMClient;
    }
  ) {
    this.agent = agent;
    this.vectorMemory = deps?.vectorMemory;
    this.planner = deps?.planner;
    this.knowledgeBase = deps?.knowledgeBase;
    this.notifications = deps?.notifications;
    this.convManager = deps?.convManager;
    this.llmClient = deps?.llmClient;
    this.config = {
      port: 3900,
      host: "0.0.0.0",
      title: "Jarvis AI",
      ...config,
    };
  }

  // ==================== 启动 / 停止 ====================

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = createServer((req, res) => this.handleRequest(req, res));
      this.server.listen(this.config.port, this.config.host, () => {
        console.log(
          `[WebChat] 🌐 http://${this.config.host}:${this.config.port}`
        );
        resolve();
      });
    });
  }

  stop(): void {
    for (const client of this.sseClients) {
      try { client.end(); } catch { /* noop */ }
    }
    this.sseClients.clear();
    this.server?.close();
  }

  // ==================== 路由 ====================

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const pathname = url.pathname;

    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    try {
      // API 路由
      if (pathname === "/api/chat" && req.method === "POST") return await this.apiChat(req, res);
      if (pathname === "/api/chat/stream" && req.method === "POST") return await this.apiChatStream(req, res);
      if (pathname === "/api/chat/history") return this.apiHistory(url, res);
      if (pathname === "/api/status") return this.apiStatus(res);
      if (pathname === "/api/skills") return this.apiSkills(res);
      if (pathname === "/api/memory") return this.apiMemory(url, res);
      if (pathname === "/api/memory/search" && req.method === "POST") return await this.apiMemorySearch(req, res);
      if (pathname === "/api/autonomous/execute" && req.method === "POST") return await this.apiAutonomousExecute(req, res);
      if (pathname === "/api/autonomous/traces") return this.apiAutonomousTraces(res);
      if (pathname === "/api/knowledge/query" && req.method === "POST") return await this.apiKnowledgeQuery(req, res);
      if (pathname === "/api/knowledge/status") return this.apiKnowledgeStatus(res);
      if (pathname === "/api/notifications") return this.apiNotifications(url, res);
      if (pathname === "/api/notifications/clear" && req.method === "POST") return this.apiNotificationsClear(res);
      if (pathname === "/api/conversations") return this.apiConversations(res);
      if (pathname === "/api/conversations/export" && req.method === "POST") return await this.apiConversationsExport(req, res);
      if (pathname === "/api/events") return this.apiSSE(res);

      // HTML 页面
      if (pathname === "/" || pathname === "/index.html") return this.serveHTML(res);

      // 404
      this.json(res, { error: "Not Found" }, 404);
    } catch (error) {
      this.json(res, { error: String(error) }, 500);
    }
  }

  // ==================== 对话 API ====================

  private async apiChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    const { message, conversationId = "default" } = JSON.parse(body);

    if (!message) {
      this.json(res, { error: "message is required" }, 400);
      return;
    }

    // 保存用户消息
    this.addMessage(conversationId, "user", message);

    // RAG 上下文增强
    let ragPrompt = "";
    if (this.vectorMemory) {
      ragPrompt = this.vectorMemory.buildRAGPrompt(message);
    }

    // 知识库上下文
    let kbContext = "";
    if (this.knowledgeBase) {
      kbContext = this.knowledgeBase.buildContext(message);
    }

    let reply: string;
    try {
      if (this.llmClient) {
        // 有 LLM：直接对话
        const systemPrompt = `你是 Jarvis，一个强大的 AI 分身助手。请用中文回复。\n${ragPrompt}${kbContext ? "\n## 知识库参考\n" + kbContext + "\n---\n" : ""}`;
        const response = await this.llmClient.chat(
          [
            { role: "system", content: systemPrompt },
            { role: "user", content: message },
          ],
          { maxTokens: 2048 }
        );
        reply = response.content;
      } else {
        // 无 LLM：走 Agent 工具链
        const task = await this.agent.run(ragPrompt + message);
        if (task.status === "completed" && task.steps.length === 0) {
          reply = this.agent.memory.getRecentMessages(1)[0]?.content || "好的，有什么可以帮你的？";
        } else if (task.status === "completed") {
          reply = `已完成: ${task.steps.map(s => s.toolName).join(" → ")}`;
        } else {
          reply = `任务状态: ${task.status}`;
        }
      }
    } catch (error) {
      reply = `执行出错: ${error instanceof Error ? error.message : String(error)}`;
    }

    // 保存助手回复
    this.addMessage(conversationId, "assistant", reply);

    // 记忆到向量库
    if (this.vectorMemory) {
      this.vectorMemory.rememberConversation(message, reply);
    }

    // 广播事件
    this.broadcast({ type: "message", data: { conversationId, role: "assistant", content: reply } });

    this.json(res, { reply, conversationId });
  }

  private async apiChatStream(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    const { message, conversationId = "default" } = JSON.parse(body);

    if (!message) {
      this.json(res, { error: "message is required" }, 400);
      return;
    }

    // SSE 响应头
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    this.addMessage(conversationId, "user", message);

    // RAG 上下文
    let ragPrompt = "";
    if (this.vectorMemory) {
      ragPrompt = this.vectorMemory.buildRAGPrompt(message);
    }

    // 知识库上下文
    let kbContext = "";
    if (this.knowledgeBase) {
      const kbResults = this.knowledgeBase.query(message, 3);
      if (kbResults.length > 0) {
        kbContext = "\n## 知识库参考\n" + kbResults.map((r) => r.chunk).join("\n\n") + "\n---\n";
      }
    }

    let reply: string;

    // 尝试真实 LLM Streaming
    if (this.llmClient) {
      try {
        const systemPrompt = ragPrompt + kbContext;
        const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];
        if (systemPrompt) {
          messages.push({ role: "system", content: systemPrompt });
        }
        messages.push({ role: "user", content: message });

        reply = await this.llmClient.chatStream(messages, {
          onChunk: (chunk) => {
            res.write(`data: ${JSON.stringify({ content: chunk, done: false })}\n\n`);
          },
          onDone: () => {
            res.write(`data: ${JSON.stringify({ content: "", done: true })}\n\n`);
          },
          onError: (err) => {
            res.write(`data: ${JSON.stringify({ error: err.message, done: true })}\n\n`);
          },
        });
      } catch {
        // LLM Streaming 失败，fallback 到 Agent
        const task = await this.agent.run(ragPrompt + kbContext + message);
        reply = task.status === "completed" && task.steps.length === 0
          ? (this.agent.memory.getRecentMessages(1)[0]?.content || "好的")
          : `已完成: ${task.steps.map(s => s.toolName).join(" → ")}`;
        const chunks = this.splitIntoChunks(reply, 20);
        for (const chunk of chunks) {
          res.write(`data: ${JSON.stringify({ content: chunk, done: false })}\n\n`);
        }
        res.write(`data: ${JSON.stringify({ content: "", done: true })}\n\n`);
      }
    } else {
      // 无 LLM Client，走 Agent 分块模拟
      try {
        const task = await this.agent.run(ragPrompt + kbContext + message);
        if (task.status === "completed" && task.steps.length === 0) {
          reply = this.agent.memory.getRecentMessages(1)[0]?.content || "好的";
        } else if (task.status === "completed") {
          reply = `已完成: ${task.steps.map(s => s.toolName).join(" → ")}`;
        } else {
          reply = `任务状态: ${task.status}`;
        }
      } catch (error) {
        reply = `执行出错: ${error instanceof Error ? error.message : String(error)}`;
      }
      const chunks = this.splitIntoChunks(reply, 20);
      for (const chunk of chunks) {
        res.write(`data: ${JSON.stringify({ content: chunk, done: false })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ content: "", done: true })}\n\n`);
    }

    this.addMessage(conversationId, "assistant", reply);

    if (this.vectorMemory) {
      this.vectorMemory.rememberConversation(message, reply);
    }

    res.end();
  }

  // ==================== 历史 ====================

  private apiHistory(url: URL, res: ServerResponse): void {
    const convId = url.searchParams.get("id") || "default";
    const messages = this.conversations.get(convId) || [];
    const allIds = Array.from(this.conversations.keys());
    this.json(res, { conversationId: convId, messages, conversations: allIds });
  }

  // ==================== 状态 ====================

  private apiStatus(res: ServerResponse): void {
    const status = this.agent.getStatus();
    const memoryStatus = this.vectorMemory?.getStatus();
    const plannerStatus = this.planner?.getStatus();

    this.json(res, {
      agent: status,
      vectorMemory: memoryStatus || null,
      planner: plannerStatus || null,
      uptime: process.uptime(),
      sseClients: this.sseClients.size,
      conversations: this.conversations.size,
    });
  }

  // ==================== Skills ====================

  private apiSkills(res: ServerResponse): void {
    const skills = this.agent.skills.getStatus();
    this.json(res, { skills, total: skills.length });
  }

  // ==================== 向量记忆 ====================

  private apiMemory(url: URL, res: ServerResponse): void {
    if (!this.vectorMemory) {
      this.json(res, { error: "VectorMemory not enabled" }, 400);
      return;
    }
    const type = url.searchParams.get("type") || undefined;
    const status = this.vectorMemory.getStatus();
    const recent = this.vectorMemory.getByType(type as "fact" || "conversation", 20);

    this.json(res, {
      status,
      recent: recent.map((e) => ({
        id: e.id,
        text: e.text.slice(0, 200),
        type: e.metadata.type,
        importance: e.metadata.importance,
        createdAt: e.metadata.createdAt,
      })),
    });
  }

  private async apiMemorySearch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.vectorMemory) {
      this.json(res, { error: "VectorMemory not enabled" }, 400);
      return;
    }
    const body = await this.readBody(req);
    const { query, limit = 5 } = JSON.parse(body);
    const results = this.vectorMemory.search(query, limit);
    this.json(res, {
      results: results.map((r) => ({
        text: r.entry.text,
        similarity: Math.round(r.similarity * 1000) / 1000,
        type: r.entry.metadata.type,
        createdAt: r.entry.metadata.createdAt,
      })),
    });
  }

  // ==================== 自主执行 ====================

  private async apiAutonomousExecute(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.planner) {
      this.json(res, { error: "AutonomousPlanner not enabled" }, 400);
      return;
    }
    const body = await this.readBody(req);
    const { goal, priority = "medium" } = JSON.parse(body);
    const task: TaskGoal = {
      id: `task-${Date.now()}`,
      goal,
      priority,
    };
    const trace = await this.planner.execute(task);
    this.broadcast({ type: "task_complete", data: { taskId: trace.taskId, status: trace.status } });
    this.json(res, { trace });
  }

  private apiAutonomousTraces(res: ServerResponse): void {
    this.json(res, { traces: this.planner?.getTraces(20) || [] });
  }

  // ==================== SSE 事件推送 ====================

  private apiSSE(res: ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
    this.sseClients.add(res);
    res.on("close", () => this.sseClients.delete(res));
  }

  private broadcast(event: { type: string; data: unknown }): void {
    const msg = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of this.sseClients) {
      try { client.write(msg); } catch { this.sseClients.delete(client); }
    }
  }

  // ==================== 现代化 Chat HTML ====================

  private serveHTML(res: ServerResponse): void {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(this.generateChatHTML());
  }

  private generateChatHTML(): string {
    const title = this.config.title || "Jarvis AI";
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
:root {
  --bg: #0a0a0f;
  --bg-secondary: #12121a;
  --bg-chat: #16161f;
  --surface: #1e1e2e;
  --surface-hover: #252536;
  --border: #2a2a3d;
  --text: #e4e4ed;
  --text-secondary: #8888a0;
  --accent: #7c6aef;
  --accent-light: #9a8cf7;
  --accent-bg: rgba(124,106,239,0.12);
  --success: #4ade80;
  --warning: #fbbf24;
  --error: #f87171;
  --user-bubble: #2a2a4a;
  --ai-bubble: #1a1a2e;
  --radius: 12px;
  --radius-sm: 8px;
  --sidebar-w: 280px;
  --header-h: 56px;
  --font: -apple-system, BlinkMacSystemFont, "SF Pro", "Segoe UI", system-ui, sans-serif;
}
[data-theme="light"] {
  --bg: #f8f9fa;
  --bg-secondary: #ffffff;
  --bg-chat: #f0f1f3;
  --surface: #ffffff;
  --surface-hover: #f0f0f5;
  --border: #e0e0e8;
  --text: #1a1a2e;
  --text-secondary: #6b7280;
  --user-bubble: #e8e6ff;
  --ai-bubble: #ffffff;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: var(--font);
  background: var(--bg);
  color: var(--text);
  height: 100vh;
  display: flex;
  overflow: hidden;
}
/* 侧边栏 */
.sidebar {
  width: var(--sidebar-w);
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}
.sidebar-header {
  padding: 16px 20px;
  display: flex;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid var(--border);
}
.logo { font-size: 20px; font-weight: 700; background: linear-gradient(135deg, var(--accent), var(--accent-light)); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
.new-chat-btn {
  margin: 12px 16px;
  padding: 10px;
  border-radius: var(--radius-sm);
  border: 1px dashed var(--border);
  cursor: pointer;
  color: var(--text-secondary);
  text-align: center;
  transition: all .2s;
  font-size: 13px;
}
.new-chat-btn:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-bg); }
.conv-list { flex: 1; overflow-y: auto; padding: 8px; }
.conv-item {
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 13px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 2px;
  transition: all .15s;
}
.conv-item:hover { background: var(--surface-hover); color: var(--text); }
.conv-item.active { background: var(--accent-bg); color: var(--accent); }
/* 侧边栏底部面板 */
.sidebar-footer {
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.status-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}
.status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--success); }
.theme-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 6px 0;
}
/* 主区域 */
.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
/* 头部 */
.chat-header {
  height: var(--header-h);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  padding: 0 24px;
  gap: 12px;
  background: var(--bg-secondary);
}
.chat-header-title { font-weight: 600; font-size: 15px; }
.chat-header-subtitle { font-size: 12px; color: var(--text-secondary); }
.header-right { margin-left: auto; display: flex; gap: 8px; }
.icon-btn {
  width: 36px; height: 36px; border-radius: var(--radius-sm);
  border: none; background: transparent; cursor: pointer; color: var(--text-secondary);
  display: flex; align-items: center; justify-content: center; font-size: 16px;
  transition: all .15s;
}
.icon-btn:hover { background: var(--surface-hover); color: var(--text); }
/* 消息区 */
.messages {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  scroll-behavior: smooth;
}
.msg {
  max-width: 80%;
  display: flex;
  gap: 10px;
}
.msg-user { align-self: flex-end; flex-direction: row-reverse; }
.msg-assistant { align-self: flex-start; }
.msg-avatar {
  width: 32px; height: 32px; border-radius: var(--radius-sm);
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; flex-shrink: 0;
}
.msg-user .msg-avatar { background: var(--accent-bg); color: var(--accent); }
.msg-assistant .msg-avatar { background: linear-gradient(135deg, var(--accent), #c084fc); color: white; }
.msg-bubble {
  padding: 12px 16px;
  border-radius: var(--radius);
  font-size: 14px;
  line-height: 1.6;
  word-break: break-word;
  white-space: pre-wrap;
}
.msg-user .msg-bubble { background: var(--user-bubble); border-bottom-right-radius: 4px; }
.msg-assistant .msg-bubble { background: var(--ai-bubble); border: 1px solid var(--border); border-bottom-left-radius: 4px; }
.msg-time { font-size: 11px; color: var(--text-secondary); margin-top: 4px; }
/* 输入区 */
.input-area {
  padding: 16px 24px 24px;
  background: var(--bg-secondary);
  border-top: 1px solid var(--border);
}
.input-wrapper {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 8px 12px;
  transition: border-color .2s;
}
.input-wrapper:focus-within { border-color: var(--accent); }
.input-wrapper textarea {
  flex: 1; border: none; background: none; color: var(--text);
  font-family: var(--font); font-size: 14px; line-height: 1.5;
  resize: none; outline: none; min-height: 24px; max-height: 120px;
}
.input-wrapper textarea::placeholder { color: var(--text-secondary); }
.send-btn {
  width: 36px; height: 36px; border-radius: var(--radius-sm);
  background: var(--accent); color: white; border: none; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; transition: opacity .2s; flex-shrink: 0;
}
.send-btn:hover { opacity: 0.85; }
.send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
/* 右侧面板 */
.right-panel {
  width: 0; overflow: hidden; transition: width .3s;
  border-left: 1px solid var(--border);
  background: var(--bg-secondary);
  display: flex; flex-direction: column;
}
.right-panel.open { width: 320px; }
.panel-header {
  height: var(--header-h);
  display: flex; align-items: center; padding: 0 16px;
  border-bottom: 1px solid var(--border); gap: 8px;
}
.panel-header h3 { font-size: 14px; font-weight: 600; }
.panel-body { flex: 1; overflow-y: auto; padding: 16px; }
.panel-section { margin-bottom: 20px; }
.panel-section h4 { font-size: 12px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; }
.stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.stat-card {
  background: var(--surface);
  border-radius: var(--radius-sm);
  padding: 12px; text-align: center;
}
.stat-value { font-size: 20px; font-weight: 700; color: var(--accent); }
.stat-label { font-size: 11px; color: var(--text-secondary); margin-top: 2px; }
.skill-chip {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 12px;
  background: var(--accent-bg);
  color: var(--accent);
  margin: 2px 4px 2px 0;
}
/* 空状态 */
.empty-state {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 16px;
  color: var(--text-secondary);
}
.empty-icon { font-size: 48px; opacity: 0.5; }
.empty-title { font-size: 18px; font-weight: 600; color: var(--text); }
.empty-desc { font-size: 14px; max-width: 400px; text-align: center; line-height: 1.6; }
.quick-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.quick-btn {
  padding: 8px 16px; border-radius: 20px; font-size: 13px;
  border: 1px solid var(--border); background: var(--surface);
  color: var(--text); cursor: pointer; transition: all .2s;
}
.quick-btn:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-bg); }
/* 加载动画 */
.typing { display: flex; gap: 4px; padding: 12px 16px; }
.typing span {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--text-secondary); animation: typeBounce 1.4s infinite;
}
.typing span:nth-child(2) { animation-delay: 0.2s; }
.typing span:nth-child(3) { animation-delay: 0.4s; }
@keyframes typeBounce { 0%,60%,100% { transform: translateY(0); } 30% { transform: translateY(-8px); } }
/* 移动端 */
@media (max-width: 768px) {
  .sidebar { position: absolute; left: -100%; z-index: 100; width: 80%; transition: left .3s; height: 100vh; }
  .sidebar.open { left: 0; }
  .right-panel.open { width: 100%; position: absolute; right: 0; z-index: 90; height: 100vh; }
  .msg { max-width: 90%; }
}
/* 滚动条 */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--text-secondary); }
</style>
</head>
<body>
<!-- 侧边栏 -->
<aside class="sidebar" id="sidebar">
  <div class="sidebar-header">
    <span class="logo">${title}</span>
  </div>
  <div class="new-chat-btn" onclick="newConversation()">+ 新对话</div>
  <div class="conv-list" id="convList"></div>
  <div class="sidebar-footer">
    <div class="status-pill"><span class="status-dot"></span> Agent 在线</div>
    <div class="theme-toggle" onclick="toggleTheme()">
      <span id="themeIcon">🌙</span> <span id="themeLabel">深色模式</span>
    </div>
  </div>
</aside>

<!-- 主区域 -->
<div class="main">
  <header class="chat-header">
    <button class="icon-btn" onclick="toggleSidebar()" title="侧边栏">☰</button>
    <div>
      <div class="chat-header-title" id="chatTitle">新对话</div>
      <div class="chat-header-subtitle" id="chatSubtitle">Jarvis AI 个人助手</div>
    </div>
    <div class="header-right">
      <button class="icon-btn" onclick="togglePanel()" title="状态面板">📊</button>
    </div>
  </header>

  <div class="messages" id="messages">
    <div class="empty-state" id="emptyState">
      <div class="empty-icon">🤖</div>
      <div class="empty-title">你好，我是 ${title}</div>
      <div class="empty-desc">你的 AI 分身助手。可以帮你管理内容创作、多平台发布、数据分析、浏览器自动化等。试试下面的快捷指令吧：</div>
      <div class="quick-actions">
        <button class="quick-btn" onclick="quickSend('查看当前所有 Skills')">查看 Skills</button>
        <button class="quick-btn" onclick="quickSend('生成一篇关于AI趋势的小红书笔记')">生成小红书笔记</button>
        <button class="quick-btn" onclick="quickSend('查看 Agent 状态')">Agent 状态</button>
        <button class="quick-btn" onclick="quickSend('搜索记忆：上次发布的内容')">搜索记忆</button>
      </div>
    </div>
  </div>

  <div class="input-area">
    <div class="input-wrapper">
      <textarea id="input" rows="1" placeholder="输入消息... (Enter 发送, Shift+Enter 换行)" onkeydown="handleKey(event)" oninput="autoResize(this)"></textarea>
      <button class="send-btn" id="sendBtn" onclick="sendMessage()" title="发送">↑</button>
    </div>
  </div>
</div>

<!-- 右侧面板 -->
<div class="right-panel" id="rightPanel">
  <div class="panel-header">
    <h3>Agent 状态</h3>
    <button class="icon-btn" onclick="togglePanel()" style="margin-left:auto">✕</button>
  </div>
  <div class="panel-body" id="panelBody">
    <div class="panel-section">
      <h4>概览</h4>
      <div class="stat-grid" id="statusGrid"></div>
    </div>
    <div class="panel-section">
      <h4>Skills</h4>
      <div id="skillsList"></div>
    </div>
    <div class="panel-section">
      <h4>记忆</h4>
      <div id="memoryInfo"></div>
    </div>
  </div>
</div>

<script>
const API = window.location.origin;
let currentConv = 'default';
let convs = new Map();
let isLoading = false;
let isDark = true;

// SSE 连接
function connectSSE() {
  const es = new EventSource(API + '/api/events');
  es.onmessage = e => {
    try {
      const ev = JSON.parse(e.data);
      if (ev.type === 'message') {
        // 来自其他端的消息
      }
    } catch {}
  };
  es.onerror = () => setTimeout(connectSSE, 3000);
}
connectSSE();

// 发送消息
async function sendMessage() {
  const input = document.getElementById('input');
  const msg = input.value.trim();
  if (!msg || isLoading) return;

  input.value = '';
  autoResize(input);
  addMsgToUI('user', msg);
  hideEmpty();
  setLoading(true);

  try {
    const res = await fetch(API + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg, conversationId: currentConv })
    });
    const data = await res.json();
    addMsgToUI('assistant', data.reply || data.error || '无响应');
  } catch (err) {
    addMsgToUI('assistant', '请求失败: ' + err.message);
  }

  setLoading(false);
  updateConvList();
}

function quickSend(text) {
  document.getElementById('input').value = text;
  sendMessage();
}

function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

// UI
function addMsgToUI(role, content) {
  const msgs = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = 'msg msg-' + role;

  const avatar = role === 'user' ? '👤' : '🤖';
  const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  div.innerHTML =
    '<div class="msg-avatar">' + avatar + '</div>' +
    '<div><div class="msg-bubble">' + escapeHtml(content) + '</div>' +
    '<div class="msg-time">' + time + '</div></div>';
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;

  // 保存到本地
  if (!convs.has(currentConv)) convs.set(currentConv, []);
  convs.get(currentConv).push({ role, content, time: new Date().toISOString() });
}

function setLoading(loading) {
  isLoading = loading;
  const btn = document.getElementById('sendBtn');
  btn.disabled = loading;

  if (loading) {
    const msgs = document.getElementById('messages');
    const div = document.createElement('div');
    div.className = 'msg msg-assistant';
    div.id = 'typing';
    div.innerHTML = '<div class="msg-avatar">🤖</div><div class="typing"><span></span><span></span><span></span></div>';
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  } else {
    const t = document.getElementById('typing');
    if (t) t.remove();
  }
}

function hideEmpty() {
  const e = document.getElementById('emptyState');
  if (e) e.style.display = 'none';
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// 对话管理
function newConversation() {
  currentConv = 'conv-' + Date.now();
  convs.set(currentConv, []);
  document.getElementById('messages').innerHTML =
    '<div class="empty-state" id="emptyState"><div class="empty-icon">🤖</div><div class="empty-title">新对话</div></div>';
  document.getElementById('chatTitle').textContent = '新对话';
  updateConvList();
}

function switchConv(id) {
  currentConv = id;
  const msgs = document.getElementById('messages');
  msgs.innerHTML = '';
  const history = convs.get(id) || [];
  if (history.length === 0) {
    msgs.innerHTML = '<div class="empty-state" id="emptyState"><div class="empty-icon">🤖</div><div class="empty-title">开始对话</div></div>';
  }
  for (const m of history) {
    const div = document.createElement('div');
    div.className = 'msg msg-' + m.role;
    const avatar = m.role === 'user' ? '👤' : '🤖';
    div.innerHTML = '<div class="msg-avatar">' + avatar + '</div><div><div class="msg-bubble">' + escapeHtml(m.content) + '</div></div>';
    msgs.appendChild(div);
  }
  msgs.scrollTop = msgs.scrollHeight;
  updateConvList();
}

function updateConvList() {
  const list = document.getElementById('convList');
  list.innerHTML = '';
  for (const [id, messages] of convs) {
    const div = document.createElement('div');
    div.className = 'conv-item' + (id === currentConv ? ' active' : '');
    const first = messages[0];
    div.textContent = first ? first.content.slice(0, 30) : '新对话';
    div.onclick = () => switchConv(id);
    list.appendChild(div);
  }
}

// 侧边栏
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

// 右侧面板
let panelOpen = false;
function togglePanel() {
  panelOpen = !panelOpen;
  document.getElementById('rightPanel').classList.toggle('open', panelOpen);
  if (panelOpen) loadPanelData();
}

async function loadPanelData() {
  try {
    const [statusRes, skillsRes] = await Promise.all([
      fetch(API + '/api/status').then(r => r.json()),
      fetch(API + '/api/skills').then(r => r.json()),
    ]);

    const grid = document.getElementById('statusGrid');
    const agentData = statusRes.agent || {};
    grid.innerHTML =
      '<div class="stat-card"><div class="stat-value">' + (agentData.skills?.active || 0) + '</div><div class="stat-label">Skills</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + (agentData.tools?.total || 0) + '</div><div class="stat-label">Tools</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + Math.round(statusRes.uptime || 0) + 's</div><div class="stat-label">Uptime</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + (statusRes.conversations || 0) + '</div><div class="stat-label">对话</div></div>';

    const skillsDiv = document.getElementById('skillsList');
    skillsDiv.innerHTML = (skillsRes.skills || []).map(s =>
      '<span class="skill-chip">' + s.name + '</span>'
    ).join('');

    const memDiv = document.getElementById('memoryInfo');
    if (statusRes.vectorMemory) {
      const vm = statusRes.vectorMemory;
      memDiv.innerHTML =
        '<div style="font-size:13px;color:var(--text-secondary)">向量条目: <b>' + vm.totalEntries + '</b> | 词汇: <b>' + vm.vocabularySize + '</b></div>';
    } else {
      memDiv.innerHTML = '<div style="font-size:13px;color:var(--text-secondary)">记忆系统就绪</div>';
    }
  } catch {}
}

// 主题切换
function toggleTheme() {
  isDark = !isDark;
  document.documentElement.setAttribute('data-theme', isDark ? '' : 'light');
  document.getElementById('themeIcon').textContent = isDark ? '🌙' : '☀️';
  document.getElementById('themeLabel').textContent = isDark ? '深色模式' : '浅色模式';
}

// 初始化
convs.set('default', []);
updateConvList();
document.getElementById('input').focus();
</script>
</body>
</html>`;
  }

  // ==================== Knowledge Base API ====================

  private async apiKnowledgeQuery(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.knowledgeBase) {
      this.json(res, { error: "KnowledgeBase not enabled" }, 400);
      return;
    }
    const body = await this.readBody(req);
    const { query, limit = 5 } = JSON.parse(body);
    const results = this.knowledgeBase.query(query, limit);
    this.json(res, { results });
  }

  private apiKnowledgeStatus(res: ServerResponse): void {
    if (!this.knowledgeBase) {
      this.json(res, { error: "KnowledgeBase not enabled" }, 400);
      return;
    }
    this.json(res, { status: this.knowledgeBase.getStatus() });
  }

  // ==================== Notifications API ====================

  private apiNotifications(url: URL, res: ServerResponse): void {
    if (!this.notifications) {
      this.json(res, { notifications: [], total: 0 });
      return;
    }
    const unreadOnly = url.searchParams.get("unread") === "true";
    const list = unreadOnly ? this.notifications.getUnread() : this.notifications.getAll();
    this.json(res, {
      notifications: list,
      total: list.length,
      unreadCount: this.notifications.getUnreadCount(),
    });
  }

  private apiNotificationsClear(res: ServerResponse): void {
    if (this.notifications) {
      this.notifications.markAllRead();
    }
    this.json(res, { success: true });
  }

  // ==================== Conversations API ====================

  private apiConversations(res: ServerResponse): void {
    if (this.convManager) {
      this.json(res, { conversations: this.convManager.listConversations() });
    } else {
      const list = Array.from(this.conversations.entries()).map(([id, msgs]) => ({
        id,
        messageCount: msgs.length,
        lastMessage: msgs[msgs.length - 1]?.content.slice(0, 100),
        updatedAt: msgs[msgs.length - 1]?.timestamp,
      }));
      this.json(res, { conversations: list });
    }
  }

  private async apiConversationsExport(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    const { conversationId, format = "json" } = JSON.parse(body);

    if (this.convManager) {
      const exported = this.convManager.exportConversation(conversationId, format);
      this.json(res, { data: exported });
    } else {
      const msgs = this.conversations.get(conversationId) || [];
      if (format === "markdown") {
        const md = msgs.map((m) => `**${m.role}** (${m.timestamp}):\n${m.content}`).join("\n\n---\n\n");
        this.json(res, { data: md });
      } else {
        this.json(res, { data: msgs });
      }
    }
  }

  // ==================== 辅助 ====================

  private addMessage(
    conversationId: string,
    role: "user" | "assistant" | "system",
    content: string
  ): void {
    if (!this.conversations.has(conversationId)) {
      this.conversations.set(conversationId, []);
    }
    this.conversations.get(conversationId)!.push({
      role,
      content,
      timestamp: new Date().toISOString(),
    });
  }

  private splitIntoChunks(text: string, chunkSize: number): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += chunkSize) {
      chunks.push(text.slice(i, i + chunkSize));
    }
    return chunks.length > 0 ? chunks : [""];
  }

  private async readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
      let data = "";
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => resolve(data));
    });
  }

  private json(res: ServerResponse, data: unknown, status = 200): void {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(data));
  }
}
