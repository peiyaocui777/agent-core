/**
 * 抖音工具集
 *
 * 通过 social-auto-upload / RPA 实现抖音内容发布
 */

import type { Tool, AgentConfig } from "../types.js";

export function createDouyinTools(config: AgentConfig = {}): Tool[] {
  const baseUrl = config.trendApiUrl || "http://localhost:18070";

  return [
    {
      name: "douyin-publish-video",
      description: "发布抖音短视频（标题+视频+标签）",
      category: "publish",
      parameters: {
        title: { type: "string", description: "视频标题（55字以内）", required: true },
        videoUrl: { type: "string", description: "视频文件 URL 或本地路径", required: true },
        tags: { type: "array", description: "标签列表（最多5个）", required: false },
        coverUrl: { type: "string", description: "封面图 URL", required: false },
        location: { type: "string", description: "定位信息", required: false },
      },
      execute: async (params) => {
        try {
          const res = await fetch(`${baseUrl}/api/douyin/publish`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(params),
          });
          const data = await res.json();
          return { success: true, data };
        } catch (error) {
          return { success: false, error: `抖音发布失败: ${error instanceof Error ? error.message : String(error)}` };
        }
      },
    },
    {
      name: "douyin-publish-image",
      description: "发布抖音图文笔记",
      category: "publish",
      parameters: {
        title: { type: "string", description: "标题", required: true },
        content: { type: "string", description: "正文内容（300字以内）", required: true },
        images: { type: "array", description: "图片 URL 列表", required: true },
        tags: { type: "array", description: "标签列表", required: false },
      },
      execute: async (params) => {
        try {
          const res = await fetch(`${baseUrl}/api/douyin/publish-image`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(params),
          });
          const data = await res.json();
          return { success: true, data };
        } catch (error) {
          return { success: false, error: `抖音图文发布失败: ${error instanceof Error ? error.message : String(error)}` };
        }
      },
    },
    {
      name: "douyin-trending",
      description: "获取抖音热搜榜/热点话题",
      category: "workflow",
      parameters: {
        count: { type: "number", description: "获取数量", required: false },
      },
      execute: async (params) => {
        try {
          const res = await fetch(`${baseUrl}/api/douyin/trending?count=${params.count || 20}`);
          const data = await res.json();
          return { success: true, data };
        } catch (error) {
          return { success: false, error: `抖音热搜获取失败: ${error instanceof Error ? error.message : String(error)}` };
        }
      },
    },
  ];
}
