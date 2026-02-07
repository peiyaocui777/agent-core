/**
 * Analytics 模块 — 跨平台数据分析引擎
 *
 * - AnalyticsEngine: 内容表现追踪 + 聚合报告 + SEO 评分
 */

export { AnalyticsEngine } from "./engine.js";
export type {
  AnalyticsConfig,
  AnalyticsPlatform,
  ContentMetrics,
  CrossPlatformReport,
  PlatformOverview,
  DailyAggregate,
  TagPerformance,
  TimeRange,
  SEOScoreResult,
  SEOCheckItem,
} from "./types.js";
