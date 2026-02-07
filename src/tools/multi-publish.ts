/**
 * 多平台统一发布工具
 *
 * 整合所有平台的发布能力，提供一键多平台分发。
 * 发布策略：
 *   - 小红书: xiaohongshu-mcp HTTP API
 *   - 公众号: ai-trend-publish 微信 API
 *   - 抖音/视频号/B站/快手: social-auto-upload (Playwright)
 */

import type { Tool, AgentConfig, ToolResult } from "../types.js";

type Platform = "xiaohongshu" | "wechat" | "douyin" | "bilibili" | "kuaishou" | "shipinhao";

interface PublishContent {
  title: string;
  content: string;
  images?: string[];
  tags?: string[];
  video?: string;
  coverImage?: string;
  digest?: string;
}

interface PlatformResult {
  platform: Platform;
  success: boolean;
  data?: unknown;
  error?: string;
  publishMethod: string;
}

export function createMultiPublishTools(config: AgentConfig): Tool[] {
  const xhsUrl = config.xhsApiUrl || "http://127.0.0.1:18060";
  const trendUrl = config.trendApiUrl || "http://127.0.0.1:3001";
  // social-auto-upload Flask backend（默认端口）
  const sauUrl = "http://127.0.0.1:8000";

  // ---- 单平台发布函数 ----

  async function publishToXhs(content: PublishContent): Promise<PlatformResult> {
    try {
      const res = await fetch(`${xhsUrl}/api/v1/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: content.title,
          content: content.content,
          images: content.images || [],
          tags: content.tags || [],
        }),
      });
      const data = await res.json();
      return {
        platform: "xiaohongshu",
        success: !!data.success,
        data,
        publishMethod: "xiaohongshu-mcp",
      };
    } catch (error) {
      return {
        platform: "xiaohongshu",
        success: false,
        error: `xiaohongshu-mcp 不可用 (${xhsUrl}): ${error instanceof Error ? error.message : String(error)}`,
        publishMethod: "xiaohongshu-mcp",
      };
    }
  }

  async function publishToWechat(content: PublishContent): Promise<PlatformResult> {
    try {
      const res = await fetch(`${trendUrl}/api/publish/wechat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "publishToWechat",
          params: {
            title: content.title,
            content: content.content,
            coverImage: content.coverImage,
            digest: content.digest,
          },
          id: Date.now().toString(),
        }),
      });
      const data = await res.json();
      return {
        platform: "wechat",
        success: true,
        data,
        publishMethod: "ai-trend-publish",
      };
    } catch (error) {
      return {
        platform: "wechat",
        success: false,
        error: `公众号发布失败: ${error instanceof Error ? error.message : String(error)}`,
        publishMethod: "ai-trend-publish",
      };
    }
  }

  async function publishViaSAU(
    platform: Platform,
    content: PublishContent
  ): Promise<PlatformResult> {
    // social-auto-upload 的 Flask API
    const platformMap: Record<string, string> = {
      douyin: "douyin",
      bilibili: "bilibili",
      kuaishou: "kuaishou",
      shipinhao: "tencent",
    };

    const sauPlatform = platformMap[platform] || platform;

    try {
      const res = await fetch(`${sauUrl}/api/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: sauPlatform,
          title: content.title,
          content: content.content,
          tags: content.tags || [],
          video: content.video,
          images: content.images,
        }),
      });

      if (!res.ok) {
        throw new Error(`social-auto-upload 返回 ${res.status}`);
      }

      const data = await res.json();
      return {
        platform,
        success: true,
        data,
        publishMethod: "social-auto-upload",
      };
    } catch (error) {
      return {
        platform,
        success: false,
        error: `${platform} 发布失败 (social-auto-upload ${sauUrl}): ${error instanceof Error ? error.message : String(error)}`,
        publishMethod: "social-auto-upload",
      };
    }
  }

  // ---- 工具定义 ----

  return [
    {
      name: "multi-publish",
      description: "一键发布到多个平台（小红书/公众号/抖音/B站/快手/视频号）",
      category: "publish",
      parameters: {
        title: { type: "string", description: "标题", required: true },
        content: { type: "string", description: "正文内容", required: true },
        images: { type: "array", description: "图片 URL 数组", required: false },
        tags: { type: "array", description: "标签数组", required: false },
        video: { type: "string", description: "视频文件路径（发布视频时需要）", required: false },
        coverImage: { type: "string", description: "封面图 URL", required: false },
        platforms: { type: "array", description: "目标平台列表: xiaohongshu/wechat/douyin/bilibili/kuaishou/shipinhao", required: true },
      },
      execute: async (params): Promise<ToolResult> => {
        const platforms = (params.platforms as Platform[]) || ["xiaohongshu"];
        const content: PublishContent = {
          title: String(params.title),
          content: String(params.content),
          images: params.images as string[],
          tags: params.tags as string[],
          video: params.video as string,
          coverImage: params.coverImage as string,
          digest: String(params.content).slice(0, 120),
        };

        // 并行发布到所有目标平台
        const publishPromises = platforms.map(async (platform) => {
          switch (platform) {
            case "xiaohongshu":
              return publishToXhs(content);
            case "wechat":
              return publishToWechat(content);
            case "douyin":
            case "bilibili":
            case "kuaishou":
            case "shipinhao":
              return publishViaSAU(platform, content);
            default:
              return {
                platform,
                success: false,
                error: `不支持的平台: ${platform}`,
                publishMethod: "none",
              } as PlatformResult;
          }
        });

        const results = await Promise.allSettled(publishPromises);
        const platformResults: PlatformResult[] = results.map((r) =>
          r.status === "fulfilled"
            ? r.value
            : {
                platform: "unknown" as Platform,
                success: false,
                error: String(r.reason),
                publishMethod: "error",
              }
        );

        const successCount = platformResults.filter((r) => r.success).length;
        const failCount = platformResults.filter((r) => !r.success).length;

        return {
          success: successCount > 0,
          data: {
            results: platformResults,
            summary: {
              total: platforms.length,
              success: successCount,
              failed: failCount,
              platforms: platforms.join(", "),
            },
          },
          error: failCount > 0
            ? `${failCount}/${platforms.length} 个平台发布失败`
            : undefined,
        };
      },
    },

    {
      name: "check-platform-status",
      description: "检查各平台服务的可用性和登录状态",
      category: "auth",
      parameters: {
        platforms: { type: "array", description: "要检查的平台列表", required: false },
      },
      execute: async (params) => {
        const platforms = (params.platforms as string[]) || [
          "xiaohongshu-mcp",
          "ai-trend-publish",
          "social-auto-upload",
        ];

        const checks = await Promise.allSettled(
          platforms.map(async (p) => {
            let url = "";
            switch (p) {
              case "xiaohongshu-mcp":
                url = `${xhsUrl}/api/v1/check_login`;
                break;
              case "ai-trend-publish":
                url = `${trendUrl}/health`;
                break;
              case "social-auto-upload":
                url = `${sauUrl}/api/status`;
                break;
              default:
                return { platform: p, status: "unknown", error: "未知平台" };
            }

            try {
              const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
              return {
                platform: p,
                status: res.ok ? "online" : "error",
                statusCode: res.status,
              };
            } catch {
              return { platform: p, status: "offline" };
            }
          })
        );

        const results = checks.map((c) =>
          c.status === "fulfilled" ? c.value : { platform: "?", status: "error" }
        );

        return {
          success: true,
          data: {
            services: results,
            onlineCount: results.filter((r) => r.status === "online").length,
            totalCount: results.length,
          },
        };
      },
    },
  ];
}
