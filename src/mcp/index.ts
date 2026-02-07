/**
 * MCP 模块 — Model Context Protocol 集成
 *
 * - McpServer: 将 Agent Skills 暴露为 MCP Server
 * - McpClient: 消费单个外部 MCP Server
 * - McpManager: 统一管理多个 MCP Server 连接
 */

export { McpServer } from "./server.js";
export { McpClient, type McpClientConfig } from "./client.js";
export { McpManager, type McpManagerConfig, type McpServerEntry, DEFAULT_MCP_SERVERS } from "./manager.js";
