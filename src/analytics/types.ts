/**
 * 数据分析引擎类型定义
 *
 * 跨平台内容表现追踪 + SEO 评分 + 趋势分析
 */

// ==================== 平台数据 ====================

/** 支持的分析平台 */
export type AnalyticsPlatform =
  | "xiaohongshu"
  | "wechat"
  | "douyin"
  | "bilibili"
  | "weibo"
  | "zhihu";

/** 单篇内容的平台表现数据 */
export interface ContentMetrics {
  /** 内容唯一标识 */
  contentId: string;
  /** 平台 */
  platform: AnalyticsPlatform;
  /** 标题 */
  title: string;
  /** 发布时间 */
  publishedAt: string;
  /** 浏览量 */
  views: number;
  /** 点赞数 */
  likes: number;
  /** 评论数 */
  comments: number;
  /** 收藏数 */
  favorites: number;
  /** 分享数 */
  shares: number;
  /** 粉丝增量 */
  followerGain: number;
  /** 互动率 (likes + comments + shares) / views */
  engagementRate: number;
  /** 最后更新时间 */
  updatedAt: string;
}

// ==================== 聚合报告 ====================

/** 时间范围 */
export type TimeRange = "today" | "7d" | "30d" | "90d" | "all";

/** 平台概览 */
export interface PlatformOverview {
  platform: AnalyticsPlatform;
  /** 总内容数 */
  totalContent: number;
  /** 总浏览量 */
  totalViews: number;
  /** 总互动数 */
  totalEngagement: number;
  /** 平均互动率 */
  avgEngagementRate: number;
  /** 最佳内容 */
  topContent?: ContentMetrics;
  /** 趋势（vs 上一周期） */
  viewsTrend: number; // 百分比变化
  engagementTrend: number;
}

/** 跨平台聚合报告 */
export interface CrossPlatformReport {
  /** 报告生成时间 */
  generatedAt: string;
  /** 时间范围 */
  timeRange: TimeRange;
  /** 各平台概览 */
  platforms: PlatformOverview[];
  /** 全局统计 */
  global: {
    totalContent: number;
    totalViews: number;
    totalEngagement: number;
    avgEngagementRate: number;
    bestPlatform: AnalyticsPlatform | null;
    bestContent: ContentMetrics | null;
  };
  /** 日报数据（每日聚合） */
  dailyData: DailyAggregate[];
  /** 内容标签表现排行 */
  tagPerformance: TagPerformance[];
}

/** 每日聚合 */
export interface DailyAggregate {
  date: string;
  views: number;
  likes: number;
  comments: number;
  publishes: number;
}

/** 标签表现 */
export interface TagPerformance {
  tag: string;
  usageCount: number;
  avgViews: number;
  avgEngagement: number;
}

// ==================== SEO 评分 ====================

/** SEO 检查项 */
export interface SEOCheckItem {
  name: string;
  description: string;
  score: number;   // 0-100
  weight: number;  // 权重
  passed: boolean;
  suggestion?: string;
}

/** SEO 评分结果 */
export interface SEOScoreResult {
  /** 总分（0-100） */
  totalScore: number;
  /** 等级 */
  grade: "A" | "B" | "C" | "D" | "F";
  /** 各项检查 */
  checks: SEOCheckItem[];
  /** 改进建议（按优先级排序） */
  improvements: string[];
  /** 关键词密度 */
  keywordDensity: Record<string, number>;
}

// ==================== 分析引擎配置 ====================

/** 分析引擎配置 */
export interface AnalyticsConfig {
  /** 数据存储路径 */
  dataPath: string;
  /** 自动采集间隔（毫秒，0 = 关闭） */
  autoCollectInterval: number;
  /** 需要追踪的平台 */
  platforms: AnalyticsPlatform[];
}
