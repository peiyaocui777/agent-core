/**
 * 小红书相关工具
 *
 * 发布方式优先级：
 * 1. xiaohongshu-mcp HTTP API（Go + Rod，推荐）
 * 2. social-auto-upload（Python + Playwright，备选，支持更多平台）
 */

import type { Tool, AgentConfig } from "../types.js";

export function createXhsTools(config: AgentConfig): Tool[] {
  const baseUrl = config.xhsApiUrl || "http://127.0.0.1:18060";

  return [
    {
      name: "xhs-publish",
      description: "发布图文内容到小红书（通过 xiaohongshu-mcp HTTP API）",
      category: "publish",
      parameters: {
        title: { type: "string", description: "标题（最多 20 个汉字）", required: true },
        content: { type: "string", description: "正文内容", required: true },
        images: { type: "array", description: "图片 URL 或 base64 数组（至少 1 张）", required: true },
        tags: { type: "array", description: "标签数组", required: false },
      },
      execute: async (params) => {
        try {
          const res = await fetch(`${baseUrl}/api/v1/publish`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: params.title,
              content: params.content,
              images: params.images,
              tags: params.tags || [],
            }),
          });

          if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`HTTP ${res.status}: ${errorText}`);
          }

          const data = await res.json();
          return {
            success: !!data.success,
            data: {
              ...data,
              platform: "xiaohongshu",
              publishMethod: "xiaohongshu-mcp",
            },
          };
        } catch (error) {
          return {
            success: false,
            error: `小红书发布失败（确认 xiaohongshu-mcp 在 ${baseUrl} 运行中）: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    },
    {
      name: "xhs-search",
      description: "搜索小红书内容（灵感采集 / 竞品分析）",
      category: "generate",
      parameters: {
        keyword: { type: "string", description: "搜索关键词", required: true },
        count: { type: "number", description: "返回条数", required: false },
      },
      execute: async (params) => {
        try {
          const res = await fetch(`${baseUrl}/api/v1/feeds/search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              keyword: params.keyword,
              count: params.count || 10,
            }),
          });

          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          return { success: true, data };
        } catch (error) {
          return {
            success: false,
            error: `小红书搜索失败: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    },
    {
      name: "xhs-check-login",
      description: "检查小红书登录状态",
      category: "auth",
      parameters: {},
      execute: async () => {
        try {
          const res = await fetch(`${baseUrl}/api/v1/check_login`);
          const data = await res.json();
          return { success: true, data: { ...data, platform: "xiaohongshu" } };
        } catch {
          return { success: false, error: `小红书服务不可达 (${baseUrl})` };
        }
      },
    },
  ];
}
