/**
 * 微信公众号相关工具
 *
 * 发布方式：
 * 1. wenyan-mcp（MCP stdio 协议，Markdown 排版 + 发布）
 * 2. ai-trend-publish（微信官方 API，草稿上传）
 * 3. 直接调用微信公众号 API（需 WECHAT_APP_ID + SECRET + IP 白名单）
 */

import type { Tool, AgentConfig } from "../types.js";

export function createWechatTools(config: AgentConfig): Tool[] {
  const trendUrl = config.trendApiUrl || "http://127.0.0.1:3001";

  return [
    {
      name: "wechat-publish",
      description: "发布文章到微信公众号草稿箱（通过 ai-trend-publish 微信 API）",
      category: "publish",
      parameters: {
        title: { type: "string", description: "文章标题", required: true },
        content: { type: "string", description: "Markdown 或 HTML 正文", required: true },
        coverImage: { type: "string", description: "封面图 URL", required: false },
        digest: { type: "string", description: "摘要（显示在消息列表）", required: false },
      },
      execute: async (params) => {
        try {
          // 通过 ai-trend-publish 的微信发布模块
          const res = await fetch(`${trendUrl}/api/publish/wechat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              method: "publishToWechat",
              params: {
                title: params.title,
                content: params.content,
                coverImage: params.coverImage,
                digest: params.digest,
              },
              id: Date.now().toString(),
            }),
          });

          if (res.ok) {
            const data = await res.json();
            return {
              success: true,
              data: {
                ...data,
                platform: "wechat",
                publishMethod: "ai-trend-publish",
              },
            };
          }

          // ai-trend-publish 不可用时的 fallback 提示
          throw new Error(`ai-trend-publish 返回 ${res.status}`);
        } catch (error) {
          // 如果 ai-trend-publish 不可用，给出 wenyan-mcp 的使用提示
          return {
            success: false,
            error: `公众号发布失败: ${error instanceof Error ? error.message : String(error)}。备选方案: 启动 wenyan-mcp 使用 MCP 协议发布。`,
            data: {
              title: params.title,
              content: params.content,
              _savedForRetry: true,
              platform: "wechat",
            },
          };
        }
      },
    },

    {
      name: "wechat-format",
      description: "将 Markdown 格式化为公众号 HTML（wenyan 排版引擎）",
      category: "format",
      parameters: {
        markdown: { type: "string", description: "Markdown 内容", required: true },
        theme: { type: "string", description: "排版主题 ID", required: false },
      },
      execute: async (params) => {
        // wenyan-mcp 使用 MCP stdio 协议，这里提供格式化的 fallback
        // 在完整版本中，通过 MCP 客户端调用 wenyan-mcp 的 format_article 工具
        const markdown = String(params.markdown);
        const theme = (params.theme as string) || "default";

        // 基础 Markdown → HTML 转换（简易版）
        let html = markdown
          .replace(/^### (.+)$/gm, "<h3>$1</h3>")
          .replace(/^## (.+)$/gm, "<h2>$1</h2>")
          .replace(/^# (.+)$/gm, "<h1>$1</h1>")
          .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
          .replace(/\*(.+?)\*/g, "<em>$1</em>")
          .replace(/\n\n/g, "</p><p>")
          .replace(/^/, "<p>")
          .replace(/$/, "</p>");

        // 包裹公众号样式
        html = `<section style="font-size:16px;line-height:1.8;color:#333;">${html}</section>`;

        return {
          success: true,
          data: {
            html,
            theme,
            _note: "简易格式化。完整排版请启动 wenyan-mcp 使用 8 个内置主题。",
          },
        };
      },
    },
  ];
}
