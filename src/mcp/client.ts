/**
 * MCP Client — 消费外部 MCP Server
 *
 * 通过 stdio 连接外部 MCP Server，动态发现并注册其工具。
 *
 * 用法：
 *   const client = new McpClient({ command: "npx", args: ["-y", "xiaohongshu-mcp"] });
 *   await client.connect();
 *   const tools = client.getTools(); // 自动转为内部 Tool 格式
 */

import { spawn, type ChildProcess } from "child_process";
import type { Tool, ToolResult } from "../types.js";

// ==================== 类型 ====================

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface McpToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties?: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
}

export interface McpClientConfig {
  /** MCP Server 启动命令 */
  command: string;
  /** 命令参数 */
  args?: string[];
  /** 环境变量 */
  env?: Record<string, string>;
  /** 工具名前缀（避免冲突） */
  toolPrefix?: string;
  /** 连接超时（毫秒） */
  timeout?: number;
}

// ==================== MCP Client ====================

export class McpClient {
  private config: McpClientConfig;
  private process: ChildProcess | null = null;
  private requestId = 1;
  private pendingRequests: Map<number, {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
  }> = new Map();
  private buffer = "";
  private tools: McpToolDef[] = [];
  private connected = false;

  constructor(config: McpClientConfig) {
    this.config = config;
  }

  /** 连接到 MCP Server */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = this.config.timeout || 10000;
      const timer = setTimeout(() => {
        reject(new Error(`MCP Server 连接超时 (${timeout}ms): ${this.config.command}`));
      }, timeout);

      try {
        this.process = spawn(this.config.command, this.config.args || [], {
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, ...this.config.env },
        });

        // 读取 stdout
        this.process.stdout!.setEncoding("utf-8");
        this.process.stdout!.on("data", (chunk: string) => {
          this.buffer += chunk;
          this.processBuffer();
        });

        // stderr 作为日志
        this.process.stderr!.setEncoding("utf-8");
        this.process.stderr!.on("data", (chunk: string) => {
          console.error(`[MCP:${this.config.command}] ${chunk.trim()}`);
        });

        this.process.on("error", (err) => {
          clearTimeout(timer);
          reject(new Error(`MCP Server 启动失败: ${err.message}`));
        });

        this.process.on("close", (code) => {
          this.connected = false;
          console.error(`[MCP Client] ${this.config.command} 已退出 (code: ${code})`);
        });

        // 发送 initialize
        this.sendRequest("initialize", {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "jarvis-agent", version: "2.1.0" },
        }).then(async () => {
          // 发送 initialized 通知
          this.sendNotification("initialized", {});

          // 获取工具列表
          const result = await this.sendRequest("tools/list", {}) as { tools: McpToolDef[] };
          this.tools = result.tools || [];
          this.connected = true;

          clearTimeout(timer);
          console.error(
            `[MCP Client] 已连接: ${this.config.command} (${this.tools.length} 个工具)`
          );
          resolve();
        }).catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  /** 断开连接 */
  async disconnect(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.connected = false;
    this.tools = [];
  }

  /** 是否已连接 */
  isConnected(): boolean {
    return this.connected;
  }

  /** 获取远程工具列表（转换为内部 Tool 格式） */
  getTools(): Tool[] {
    const prefix = this.config.toolPrefix || "";
    return this.tools.map((mcpTool) => this.mcpToolToInternal(mcpTool, prefix));
  }

  /** 调用远程工具 */
  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (!this.connected) {
      return { success: false, error: "MCP Server 未连接" };
    }

    try {
      const result = await this.sendRequest("tools/call", {
        name,
        arguments: args,
      }) as { content?: Array<{ type: string; text?: string }>; isError?: boolean };

      const text = result.content?.map((c) => c.text || "").join("\n") || "";

      if (result.isError) {
        return { success: false, error: text };
      }

      // 尝试解析 JSON
      try {
        return { success: true, data: JSON.parse(text) };
      } catch {
        return { success: true, data: text };
      }
    } catch (error) {
      return {
        success: false,
        error: `MCP 调用失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // ==================== 内部方法 ====================

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const msg = JSON.parse(trimmed) as JsonRpcMessage;
        this.handleMessage(msg);
      } catch {
        // 忽略非 JSON 行
      }
    }
  }

  private handleMessage(msg: JsonRpcMessage): void {
    // 响应
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const pending = this.pendingRequests.get(msg.id as number);
      if (pending) {
        this.pendingRequests.delete(msg.id as number);
        if (msg.error) {
          pending.reject(new Error(msg.error.message));
        } else {
          pending.resolve(msg.result);
        }
      }
      return;
    }

    // 通知或请求（来自 Server）
    if (msg.method) {
      console.error(`[MCP Client] 收到服务端消息: ${msg.method}`);
    }
  }

  private sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.requestId++;
      this.pendingRequests.set(id, { resolve, reject });

      const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
      this.process?.stdin?.write(msg + "\n");
    });
  }

  private sendNotification(method: string, params: Record<string, unknown>): void {
    const msg = JSON.stringify({ jsonrpc: "2.0", method, params });
    this.process?.stdin?.write(msg + "\n");
  }

  /** 将 MCP Tool 转换为内部 Tool 格式 */
  private mcpToolToInternal(mcpTool: McpToolDef, prefix: string): Tool {
    const name = prefix ? `${prefix}:${mcpTool.name}` : mcpTool.name;
    const props = mcpTool.inputSchema.properties || {};
    const required = new Set(mcpTool.inputSchema.required || []);

    return {
      name,
      description: mcpTool.description,
      category: "workflow",
      parameters: Object.fromEntries(
        Object.entries(props).map(([key, val]) => [
          key,
          {
            type: val.type as "string" | "number" | "boolean" | "array" | "object",
            description: val.description || key,
            required: required.has(key),
          },
        ])
      ),
      execute: async (params) => this.callTool(mcpTool.name, params),
    };
  }
}
