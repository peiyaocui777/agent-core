/**
 * MCP Manager — 统一管理多个 MCP Server 连接
 *
 * 功能：
 * - 从配置文件加载 MCP Server 列表
 * - 批量连接/断开
 * - 聚合所有远程工具到 Agent
 * - 健康检查 & 自动重连
 */

import { McpClient, type McpClientConfig } from "./client.js";
import type { Tool } from "../types.js";

export interface McpServerEntry {
  /** 服务名 */
  name: string;
  /** 是否启用 */
  enabled: boolean;
  /** MCP Client 配置 */
  config: McpClientConfig;
}

export interface McpManagerConfig {
  /** MCP Server 列表 */
  servers: McpServerEntry[];
  /** 自动重连间隔（毫秒），0 表示不重连 */
  autoReconnectMs?: number;
}

export class McpManager {
  private clients: Map<string, McpClient> = new Map();
  private config: McpManagerConfig;
  private reconnectTimer?: ReturnType<typeof setInterval>;

  constructor(config: McpManagerConfig) {
    this.config = config;
  }

  /** 连接所有已启用的 MCP Server */
  async connectAll(): Promise<{ connected: string[]; failed: string[] }> {
    const connected: string[] = [];
    const failed: string[] = [];

    const enabledServers = this.config.servers.filter((s) => s.enabled);

    await Promise.allSettled(
      enabledServers.map(async (entry) => {
        try {
          const client = new McpClient({
            ...entry.config,
            toolPrefix: entry.config.toolPrefix || entry.name,
          });
          await client.connect();
          this.clients.set(entry.name, client);
          connected.push(entry.name);
        } catch (error) {
          console.error(
            `[MCP Manager] ${entry.name} 连接失败:`,
            error instanceof Error ? error.message : error
          );
          failed.push(entry.name);
        }
      })
    );

    // 启动自动重连
    if (this.config.autoReconnectMs && this.config.autoReconnectMs > 0) {
      this.startAutoReconnect();
    }

    console.error(
      `[MCP Manager] 已连接 ${connected.length}/${enabledServers.length} 个 MCP Server`
    );

    return { connected, failed };
  }

  /** 断开所有连接 */
  async disconnectAll(): Promise<void> {
    this.stopAutoReconnect();

    for (const [name, client] of this.clients) {
      try {
        await client.disconnect();
        console.error(`[MCP Manager] 已断开: ${name}`);
      } catch (error) {
        console.error(`[MCP Manager] 断开 ${name} 失败:`, error);
      }
    }
    this.clients.clear();
  }

  /** 获取所有远程工具（聚合所有 MCP Server） */
  getAllTools(): Tool[] {
    const tools: Tool[] = [];
    for (const client of this.clients.values()) {
      if (client.isConnected()) {
        tools.push(...client.getTools());
      }
    }
    return tools;
  }

  /** 获取指定 Server 的工具 */
  getServerTools(name: string): Tool[] {
    const client = this.clients.get(name);
    if (!client || !client.isConnected()) return [];
    return client.getTools();
  }

  /** 获取连接状态 */
  getStatus(): Array<{ name: string; connected: boolean; toolCount: number }> {
    return this.config.servers
      .filter((s) => s.enabled)
      .map((entry) => {
        const client = this.clients.get(entry.name);
        return {
          name: entry.name,
          connected: client?.isConnected() || false,
          toolCount: client?.isConnected() ? client.getTools().length : 0,
        };
      });
  }

  /** 获取特定 Client */
  getClient(name: string): McpClient | undefined {
    return this.clients.get(name);
  }

  // ==================== 自动重连 ====================

  private startAutoReconnect(): void {
    this.reconnectTimer = setInterval(async () => {
      for (const entry of this.config.servers.filter((s) => s.enabled)) {
        const client = this.clients.get(entry.name);
        if (!client || !client.isConnected()) {
          try {
            console.error(`[MCP Manager] 重连: ${entry.name}`);
            const newClient = new McpClient({
              ...entry.config,
              toolPrefix: entry.config.toolPrefix || entry.name,
            });
            await newClient.connect();
            this.clients.set(entry.name, newClient);
            console.error(`[MCP Manager] 重连成功: ${entry.name}`);
          } catch {
            // 下次重试
          }
        }
      }
    }, this.config.autoReconnectMs);
  }

  private stopAutoReconnect(): void {
    if (this.reconnectTimer) {
      clearInterval(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }
}

// ==================== 默认 MCP Server 配置 ====================

/** 预设的 MCP Server 配置 */
export const DEFAULT_MCP_SERVERS: McpServerEntry[] = [
  {
    name: "filesystem",
    enabled: false,
    config: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      timeout: 15000,
    },
  },
  {
    name: "github",
    enabled: false,
    config: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "" },
      timeout: 15000,
    },
  },
  {
    name: "web-search",
    enabled: false,
    config: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-brave-search"],
      env: { BRAVE_API_KEY: "" },
      timeout: 15000,
    },
  },
];
