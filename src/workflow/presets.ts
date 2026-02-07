/**
 * 预设管道模板
 *
 * 提供常用的内容运营管道：
 * - 内容创作管道（热点采集 → 内容生成 → 配图 → 发布）
 * - 多平台分发管道（格式化 → 并行发布多平台）
 * - 定时日报管道（采集 → 分析 → 生成报告）
 */

import type { PipelineDefinition } from "./types.js";

/** 内容创作管道 */
export const CONTENT_CREATION_PIPELINE: PipelineDefinition = {
  id: "content-creation",
  name: "内容创作管道",
  description: "热点采集 → AI 内容生成 → 配图 → 审阅 → 多平台发布",
  version: "1.0.0",
  nodes: [
    {
      id: "research",
      type: "tool",
      name: "热点采集",
      config: {
        type: "tool",
        toolName: "scrape-trending",
        paramMapping: { topic: "topic" },
        outputKey: "research_result",
      },
      status: "idle",
      retry: { maxAttempts: 2, delayMs: 3000 },
    },
    {
      id: "generate-content",
      type: "tool",
      name: "AI 内容生成",
      config: {
        type: "tool",
        toolName: "ai-generate-content",
        paramMapping: { topic: "topic" },
        outputKey: "content",
      },
      status: "idle",
      retry: { maxAttempts: 2, delayMs: 2000 },
    },
    {
      id: "generate-image",
      type: "tool",
      name: "封面配图",
      config: {
        type: "tool",
        toolName: "ai-generate-image",
        paramMapping: { prompt: "topic" },
        outputKey: "cover_image",
      },
      status: "idle",
    },
    {
      id: "review-gate",
      type: "condition",
      name: "质量检查",
      description: "检查内容是否满足发布标准",
      config: {
        type: "condition",
        expression: "ctx.content && ctx.content.length > 100",
        trueBranch: "publish",
        falseBranch: "regenerate",
      },
      status: "idle",
    },
    {
      id: "regenerate",
      type: "tool",
      name: "内容重写",
      config: {
        type: "tool",
        toolName: "ai-generate-content",
        params: { type: "rewrite" },
        paramMapping: { topic: "topic", previousContent: "content" },
        outputKey: "content",
      },
      status: "idle",
    },
    {
      id: "publish",
      type: "tool",
      name: "多平台发布",
      config: {
        type: "tool",
        toolName: "multi-publish",
        params: { platforms: ["xiaohongshu", "wechat"] },
        paramMapping: { content: "content", coverImage: "cover_image" },
        outputKey: "publish_result",
      },
      status: "idle",
    },
  ],
  edges: [
    { from: "research", to: "generate-content" },
    { from: "generate-content", to: "generate-image" },
    { from: "generate-image", to: "review-gate" },
    { from: "regenerate", to: "publish" },
  ],
  entryNodeId: "research",
};

/** 多平台分发管道 */
export const MULTI_PUBLISH_PIPELINE: PipelineDefinition = {
  id: "multi-publish",
  name: "多平台分发管道",
  description: "将已有内容格式化后并行发布到多个平台",
  version: "1.0.0",
  nodes: [
    {
      id: "prepare",
      type: "transform",
      name: "内容准备",
      config: {
        type: "transform",
        transformFn: `return { content: ctx.content, title: ctx.title || '默认标题' }`,
        outputKey: "prepared",
      },
      status: "idle",
    },
    {
      id: "parallel-publish",
      type: "parallel",
      name: "并行发布",
      config: {
        type: "parallel",
        nodeIds: ["publish-xhs", "publish-wechat"],
        waitFor: "all",
      },
      status: "idle",
    },
    {
      id: "publish-xhs",
      type: "tool",
      name: "发布小红书",
      config: {
        type: "tool",
        toolName: "xhs-publish",
        paramMapping: { content: "prepared.content", title: "prepared.title" },
        outputKey: "xhs_result",
      },
      status: "idle",
      retry: { maxAttempts: 2, delayMs: 5000 },
    },
    {
      id: "publish-wechat",
      type: "tool",
      name: "发布公众号",
      config: {
        type: "tool",
        toolName: "wechat-publish",
        paramMapping: { content: "prepared.content", title: "prepared.title" },
        outputKey: "wechat_result",
      },
      status: "idle",
      retry: { maxAttempts: 2, delayMs: 5000 },
    },
  ],
  edges: [
    { from: "prepare", to: "parallel-publish" },
  ],
  entryNodeId: "prepare",
};

/** 定时日报管道 */
export const DAILY_REPORT_PIPELINE: PipelineDefinition = {
  id: "daily-report",
  name: "定时日报管道",
  description: "每日采集热点 → 分析趋势 → 生成日报 → 推送",
  version: "1.0.0",
  nodes: [
    {
      id: "collect",
      type: "tool",
      name: "全平台采集",
      config: {
        type: "tool",
        toolName: "scrape-trending",
        params: { topic: "每日热点" },
        outputKey: "raw_data",
      },
      status: "idle",
      retry: { maxAttempts: 3, delayMs: 5000 },
    },
    {
      id: "analyze",
      type: "tool",
      name: "趋势分析",
      config: {
        type: "tool",
        toolName: "ai-generate-content",
        params: { topic: "分析今日热点趋势，总结 top 10 话题", type: "analysis" },
        paramMapping: { context: "raw_data" },
        outputKey: "analysis",
      },
      status: "idle",
    },
    {
      id: "generate-report",
      type: "tool",
      name: "生成日报",
      config: {
        type: "tool",
        toolName: "ai-generate-content",
        params: { topic: "生成今日运营日报", type: "report" },
        paramMapping: { analysis: "analysis" },
        outputKey: "report",
      },
      status: "idle",
    },
    {
      id: "delay-push",
      type: "delay",
      name: "等待最佳推送时间",
      config: { type: "delay", delayMs: 1000 },
      status: "idle",
    },
    {
      id: "push",
      type: "tool",
      name: "推送日报",
      config: {
        type: "tool",
        toolName: "multi-publish",
        params: { platforms: ["wechat"] },
        paramMapping: { content: "report" },
        outputKey: "push_result",
      },
      status: "idle",
    },
  ],
  edges: [
    { from: "collect", to: "analyze" },
    { from: "analyze", to: "generate-report" },
    { from: "generate-report", to: "delay-push" },
    { from: "delay-push", to: "push" },
  ],
  entryNodeId: "collect",
};

/** 获取所有预设管道 */
export function getAllPresetPipelines(): PipelineDefinition[] {
  return [
    CONTENT_CREATION_PIPELINE,
    MULTI_PUBLISH_PIPELINE,
    DAILY_REPORT_PIPELINE,
  ];
}
