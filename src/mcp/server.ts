/**
 * MCP Server — 将 Agent Skills 暴露为标准 MCP 协议
 *
 * 实现 Model Context Protocol (2025-11-25) 的 stdio 传输层：
 * - JSON-RPC 2.0 消息格式
 * - initialize / initialized 生命周期
 * - tools/list — 列出所有可用工具
 * - tools/call — 调用指定工具
 *
 * 用法：
 *   npx tsx src/mcp/server.ts   # 作为 MCP Server 运行
 *   在 Cursor/Claude 中配置为 MCP Server
 */

import type { AgentCore } from "../agent.js";
import type { Tool, ToolResult } from "../types.js";

// ==================== JSON-RPC 类型 ====================

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// ==================== MCP 协议类型 ====================

interface McpToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

// ==================== MCP Server ====================

export class McpServer {
  private agent: AgentCore;
  private initialized = false;
  private buffer = "";

  constructor(agent: AgentCore) {
    this.agent = agent;
  }

  /** 启动 MCP Server（stdio 模式） */
  async start(): Promise<void> {
    // 读取 stdin
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk: string) => {
      this.buffer += chunk;
      this.processBuffer();
    });

    process.stdin.on("end", () => {
      process.exit(0);
    });

    // 日志输出到 stderr（MCP 规范）
    console.error("[MCP Server] 启动，等待客户端连接...");
  }

  /** 处理缓冲区中的消息 */
  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || ""; // 保留最后不完整的行

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const msg = JSON.parse(trimmed);
        this.handleMessage(msg).catch((err) => {
          console.error("[MCP Server] 处理消息异常:", err);
        });
      } catch {
        console.error("[MCP Server] 无效 JSON:", trimmed.slice(0, 100));
      }
    }
  }

  /** 处理单条消息 */
  private async handleMessage(msg: JsonRpcRequest | JsonRpcNotification): Promise<void> {
    // 通知（无 id）
    if (!("id" in msg)) {
      await this.handleNotification(msg as JsonRpcNotification);
      return;
    }

    // 请求
    const request = msg as JsonRpcRequest;
    try {
      const result = await this.handleRequest(request);
      this.send({ jsonrpc: "2.0", id: request.id, result });
    } catch (error) {
      this.send({
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  /** 处理 JSON-RPC 请求 */
  private async handleRequest(req: JsonRpcRequest): Promise<unknown> {
    switch (req.method) {
      case "initialize":
        return this.handleInitialize(req.params || {});

      case "tools/list":
        return this.handleToolsList();

      case "tools/call":
        return this.handleToolsCall(req.params || {});

      case "ping":
        return {};

      default:
        throw Object.assign(new Error(`方法未实现: ${req.method}`), { code: -32601 });
    }
  }

  /** 处理通知 */
  private async handleNotification(notif: JsonRpcNotification): Promise<void> {
    switch (notif.method) {
      case "initialized":
        this.initialized = true;
        console.error("[MCP Server] 客户端已确认初始化");
        break;

      case "notifications/cancelled":
        console.error("[MCP Server] 请求被取消:", notif.params);
        break;

      default:
        console.error("[MCP Server] 未知通知:", notif.method);
    }
  }

  // ==================== MCP 方法实现 ====================

  /** initialize — 协商能力 */
  private handleInitialize(_params: Record<string, unknown>): unknown {
    console.error("[MCP Server] 初始化请求");

    return {
      protocolVersion: "2025-11-25",
      capabilities: {
        tools: {
          listChanged: true,
        },
      },
      serverInfo: {
        name: "jarvis-agent",
        version: "2.1.0",
      },
    };
  }

  /** tools/list — 列出所有可用工具 */
  private handleToolsList(): unknown {
    const tools = this.agent.getAllTools();

    return {
      tools: tools.map((tool) => this.toolToMcpDef(tool)),
    };
  }

  /** tools/call — 调用工具 */
  private async handleToolsCall(params: Record<string, unknown>): Promise<unknown> {
    const toolName = params.name as string;
    const args = (params.arguments as Record<string, unknown>) || {};

    if (!toolName) {
      throw new Error("缺少 name 参数");
    }

    const tool = this.agent.getTool(toolName);
    if (!tool) {
      throw new Error(`工具未找到: ${toolName}`);
    }

    console.error(`[MCP Server] 调用工具: ${toolName}`);

    const result = await this.agent.executeTool(toolName, args);

    return this.toolResultToMcp(result);
  }

  // ==================== 格式转换 ====================

  /** 将内部 Tool 转换为 MCP Tool 定义 */
  private toolToMcpDef(tool: Tool): McpToolDef {
    const properties: Record<string, { type: string; description: string }> = {};
    const required: string[] = [];

    for (const [key, param] of Object.entries(tool.parameters)) {
      properties[key] = {
        type: param.type === "array" ? "array" : param.type === "object" ? "object" : param.type,
        description: param.description,
      };
      if (param.required) {
        required.push(key);
      }
    }

    return {
      name: tool.name,
      description: tool.description,
      inputSchema: {
        type: "object",
        properties,
        required,
      },
    };
  }

  /** 将 ToolResult 转换为 MCP 响应格式 */
  private toolResultToMcp(result: ToolResult): unknown {
    if (result.success) {
      return {
        content: [
          {
            type: "text",
            text: typeof result.data === "string"
              ? result.data
              : JSON.stringify(result.data, null, 2),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: result.error || "工具执行失败",
        },
      ],
      isError: true,
    };
  }

  /** 发送 JSON-RPC 响应到 stdout */
  private send(msg: JsonRpcResponse): void {
    process.stdout.write(JSON.stringify(msg) + "\n");
  }
}
