/**
 * Analytics Engine — 跨平台数据分析引擎
 *
 * 功能：
 * 1. 内容表现追踪（浏览量/互动/增粉）
 * 2. 跨平台聚合报告
 * 3. SEO 内容评分
 * 4. 趋势分析 + 标签效果
 */

import * as fs from "fs";
import * as path from "path";
import type {
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

// ==================== 默认配置 ====================

const DEFAULT_CONFIG: AnalyticsConfig = {
  dataPath: "/tmp/jarvis-analytics.json",
  autoCollectInterval: 0,
  platforms: ["xiaohongshu", "wechat", "douyin", "bilibili", "weibo", "zhihu"],
};

// ==================== 持久化数据结构 ====================

interface AnalyticsData {
  metrics: ContentMetrics[];
  tags: Record<string, string[]>; // contentId → tags
}

// ==================== Analytics Engine ====================

export class AnalyticsEngine {
  private config: AnalyticsConfig;
  private data: AnalyticsData = { metrics: [], tags: {} };

  constructor(config?: Partial<AnalyticsConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.load();
  }

  // ==================== 数据录入 ====================

  /**
   * 记录内容发布数据
   */
  trackContent(metrics: ContentMetrics, tags?: string[]): void {
    // 查找是否已存在
    const idx = this.data.metrics.findIndex(
      (m) => m.contentId === metrics.contentId && m.platform === metrics.platform
    );

    if (idx >= 0) {
      this.data.metrics[idx] = { ...metrics, updatedAt: new Date().toISOString() };
    } else {
      this.data.metrics.push({
        ...metrics,
        updatedAt: new Date().toISOString(),
      });
    }

    if (tags) {
      this.data.tags[metrics.contentId] = tags;
    }

    this.save();
  }

  /**
   * 批量更新指标（如定时采集回填）
   */
  batchUpdate(updates: Array<{ contentId: string; platform: AnalyticsPlatform; delta: Partial<ContentMetrics> }>): number {
    let updated = 0;
    for (const upd of updates) {
      const item = this.data.metrics.find(
        (m) => m.contentId === upd.contentId && m.platform === upd.platform
      );
      if (item) {
        Object.assign(item, upd.delta, { updatedAt: new Date().toISOString() });
        // 重算互动率
        if (item.views > 0) {
          item.engagementRate = (item.likes + item.comments + item.shares) / item.views;
        }
        updated++;
      }
    }
    if (updated > 0) this.save();
    return updated;
  }

  // ==================== 查询 ====================

  /**
   * 获取单个平台的内容列表
   */
  getContentByPlatform(platform: AnalyticsPlatform, limit = 50): ContentMetrics[] {
    return this.data.metrics
      .filter((m) => m.platform === platform)
      .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
      .slice(0, limit);
  }

  /**
   * 获取 Top 内容（按互动率）
   */
  getTopContent(limit = 10, platform?: AnalyticsPlatform): ContentMetrics[] {
    let items = this.data.metrics;
    if (platform) items = items.filter((m) => m.platform === platform);

    return items
      .sort((a, b) => b.engagementRate - a.engagementRate)
      .slice(0, limit);
  }

  // ==================== 报告生成 ====================

  /**
   * 生成跨平台聚合报告
   */
  generateReport(timeRange: TimeRange = "30d"): CrossPlatformReport {
    const cutoff = this.getCutoffDate(timeRange);
    const filtered = this.data.metrics.filter(
      (m) => new Date(m.publishedAt) >= cutoff
    );

    // 各平台概览
    const platforms: PlatformOverview[] = this.config.platforms.map((platform) => {
      const platformData = filtered.filter((m) => m.platform === platform);
      const totalViews = platformData.reduce((s, m) => s + m.views, 0);
      const totalEngagement = platformData.reduce(
        (s, m) => s + m.likes + m.comments + m.shares,
        0
      );
      const avgEngagementRate =
        platformData.length > 0
          ? platformData.reduce((s, m) => s + m.engagementRate, 0) / platformData.length
          : 0;

      const topContent = platformData.sort((a, b) => b.views - a.views)[0];

      // 趋势（vs 上一周期）
      const prevCutoff = this.getCutoffDate(timeRange, 2);
      const prevData = this.data.metrics.filter(
        (m) =>
          m.platform === platform &&
          new Date(m.publishedAt) >= prevCutoff &&
          new Date(m.publishedAt) < cutoff
      );
      const prevViews = prevData.reduce((s, m) => s + m.views, 0);
      const prevEngagement = prevData.reduce(
        (s, m) => s + m.likes + m.comments + m.shares,
        0
      );

      return {
        platform,
        totalContent: platformData.length,
        totalViews,
        totalEngagement,
        avgEngagementRate,
        topContent,
        viewsTrend: prevViews > 0 ? ((totalViews - prevViews) / prevViews) * 100 : 0,
        engagementTrend:
          prevEngagement > 0
            ? ((totalEngagement - prevEngagement) / prevEngagement) * 100
            : 0,
      };
    });

    // 全局统计
    const totalContent = filtered.length;
    const totalViews = filtered.reduce((s, m) => s + m.views, 0);
    const totalEngagement = filtered.reduce(
      (s, m) => s + m.likes + m.comments + m.shares,
      0
    );
    const avgEngagementRate =
      totalContent > 0
        ? filtered.reduce((s, m) => s + m.engagementRate, 0) / totalContent
        : 0;

    const bestPlatform = platforms.sort(
      (a, b) => b.totalEngagement - a.totalEngagement
    )[0];
    const bestContent = filtered.sort((a, b) => b.views - a.views)[0] || null;

    // 日报数据
    const dailyData = this.aggregateDaily(filtered);

    // 标签表现
    const tagPerformance = this.analyzeTagPerformance(filtered);

    return {
      generatedAt: new Date().toISOString(),
      timeRange,
      platforms,
      global: {
        totalContent,
        totalViews,
        totalEngagement,
        avgEngagementRate,
        bestPlatform: bestPlatform?.platform || null,
        bestContent,
      },
      dailyData,
      tagPerformance,
    };
  }

  // ==================== SEO 评分 ====================

  /**
   * 对内容进行 SEO 评分
   */
  scoreSEO(
    content: string,
    title: string,
    options?: {
      targetKeywords?: string[];
      platform?: AnalyticsPlatform;
    }
  ): SEOScoreResult {
    const checks: SEOCheckItem[] = [];
    const targetKeywords = options?.targetKeywords || [];

    // 1. 标题长度
    checks.push({
      name: "标题长度",
      description: "标题应在 10-30 字之间",
      score: title.length >= 10 && title.length <= 30 ? 100 : title.length < 5 ? 20 : 60,
      weight: 15,
      passed: title.length >= 10 && title.length <= 30,
      suggestion: title.length < 10 ? "标题太短，建议补充核心关键词" : title.length > 30 ? "标题过长，建议精简" : undefined,
    });

    // 2. 内容长度
    const idealMin = 300;
    const idealMax = 2000;
    const contentLen = content.length;
    checks.push({
      name: "内容长度",
      description: `正文应在 ${idealMin}-${idealMax} 字之间`,
      score: contentLen >= idealMin && contentLen <= idealMax ? 100 : contentLen < 100 ? 20 : 60,
      weight: 10,
      passed: contentLen >= idealMin && contentLen <= idealMax,
      suggestion: contentLen < idealMin ? `内容过短(${contentLen}字)，建议补充到 ${idealMin} 字以上` : undefined,
    });

    // 3. 关键词覆盖
    if (targetKeywords.length > 0) {
      const foundCount = targetKeywords.filter((kw) =>
        content.toLowerCase().includes(kw.toLowerCase()) ||
        title.toLowerCase().includes(kw.toLowerCase())
      ).length;
      const coverage = foundCount / targetKeywords.length;
      checks.push({
        name: "关键词覆盖",
        description: "目标关键词应出现在标题或正文中",
        score: Math.round(coverage * 100),
        weight: 20,
        passed: coverage >= 0.7,
        suggestion: coverage < 0.7 ? `仅覆盖 ${foundCount}/${targetKeywords.length} 个关键词` : undefined,
      });
    }

    // 4. 标题含关键词
    if (targetKeywords.length > 0) {
      const titleHasKw = targetKeywords.some((kw) =>
        title.toLowerCase().includes(kw.toLowerCase())
      );
      checks.push({
        name: "标题含关键词",
        description: "标题中应包含至少一个核心关键词",
        score: titleHasKw ? 100 : 0,
        weight: 15,
        passed: titleHasKw,
        suggestion: titleHasKw ? undefined : "建议在标题中嵌入核心关键词",
      });
    }

    // 5. 段落结构
    const paragraphs = content.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
    const hasGoodStructure = paragraphs.length >= 3;
    checks.push({
      name: "段落结构",
      description: "内容应分为 3 段以上",
      score: hasGoodStructure ? 100 : paragraphs.length === 2 ? 60 : 20,
      weight: 10,
      passed: hasGoodStructure,
      suggestion: hasGoodStructure ? undefined : "建议将内容分为多个段落，提高可读性",
    });

    // 6. Emoji / 特殊符号使用
    const emojiCount = (content.match(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu) || []).length;
    const hasEmoji = emojiCount >= 3;
    checks.push({
      name: "Emoji 丰富度",
      description: "适当使用 Emoji 提升阅读体验（3+个）",
      score: hasEmoji ? 100 : emojiCount > 0 ? 60 : 30,
      weight: 5,
      passed: hasEmoji,
      suggestion: hasEmoji ? undefined : "建议添加 Emoji 提升视觉吸引力",
    });

    // 7. 标签/话题
    const hashtagCount = (content.match(/#[^\s#]+/g) || []).length;
    const hasHashtags = hashtagCount >= 3;
    checks.push({
      name: "标签/话题",
      description: "应包含 3 个以上相关话题标签",
      score: hasHashtags ? 100 : hashtagCount > 0 ? 50 : 0,
      weight: 10,
      passed: hasHashtags,
      suggestion: hasHashtags ? undefined : `仅 ${hashtagCount} 个标签，建议添加更多相关话题`,
    });

    // 8. 行动号召 (CTA)
    const ctaPatterns = ["点赞", "关注", "收藏", "转发", "评论", "留言", "私信", "点击"];
    const hasCTA = ctaPatterns.some((p) => content.includes(p));
    checks.push({
      name: "行动号召 (CTA)",
      description: "应包含引导互动的行动号召",
      score: hasCTA ? 100 : 0,
      weight: 10,
      passed: hasCTA,
      suggestion: hasCTA ? undefined : "建议在结尾添加互动引导（如：你觉得呢？欢迎留言讨论）",
    });

    // 9. 原创性信号
    const originalPatterns = ["我", "亲测", "实测", "个人经验", "分享", "推荐"];
    const hasOriginalSignal = originalPatterns.some((p) => content.includes(p));
    checks.push({
      name: "原创性信号",
      description: "包含个人视角和原创性表达",
      score: hasOriginalSignal ? 100 : 40,
      weight: 5,
      passed: hasOriginalSignal,
      suggestion: hasOriginalSignal ? undefined : "建议加入个人体验和观点，增强原创性",
    });

    // 计算总分
    const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
    const totalScore = Math.round(
      checks.reduce((s, c) => s + (c.score * c.weight) / totalWeight, 0)
    );

    // 等级
    const grade =
      totalScore >= 90 ? "A" : totalScore >= 75 ? "B" : totalScore >= 60 ? "C" : totalScore >= 40 ? "D" : "F";

    // 改进建议
    const improvements = checks
      .filter((c) => !c.passed && c.suggestion)
      .sort((a, b) => b.weight - a.weight)
      .map((c) => c.suggestion!);

    // 关键词密度
    const keywordDensity: Record<string, number> = {};
    const words = content.length;
    for (const kw of targetKeywords) {
      const regex = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      const matches = content.match(regex) || [];
      keywordDensity[kw] = words > 0 ? Number(((matches.length / words) * 100).toFixed(2)) : 0;
    }

    return { totalScore, grade, checks, improvements, keywordDensity };
  }

  // ==================== 统计 ====================

  /** 获取引擎状态 */
  getStatus(): {
    totalRecords: number;
    platforms: Record<string, number>;
    latestUpdate: string | null;
  } {
    const platforms: Record<string, number> = {};
    for (const m of this.data.metrics) {
      platforms[m.platform] = (platforms[m.platform] || 0) + 1;
    }

    const latest = this.data.metrics
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];

    return {
      totalRecords: this.data.metrics.length,
      platforms,
      latestUpdate: latest?.updatedAt || null,
    };
  }

  /** 获取所有数据（导出） */
  exportData(): AnalyticsData {
    return { ...this.data };
  }

  // ==================== 内部辅助 ====================

  private getCutoffDate(range: TimeRange, multiplier = 1): Date {
    const now = new Date();
    switch (range) {
      case "today":
        return new Date(now.getFullYear(), now.getMonth(), now.getDate());
      case "7d":
        return new Date(now.getTime() - 7 * 24 * 3600000 * multiplier);
      case "30d":
        return new Date(now.getTime() - 30 * 24 * 3600000 * multiplier);
      case "90d":
        return new Date(now.getTime() - 90 * 24 * 3600000 * multiplier);
      case "all":
        return new Date(0);
      default:
        return new Date(now.getTime() - 30 * 24 * 3600000 * multiplier);
    }
  }

  private aggregateDaily(metrics: ContentMetrics[]): DailyAggregate[] {
    const map = new Map<string, DailyAggregate>();

    for (const m of metrics) {
      const date = m.publishedAt.slice(0, 10);
      const existing = map.get(date) || { date, views: 0, likes: 0, comments: 0, publishes: 0 };
      existing.views += m.views;
      existing.likes += m.likes;
      existing.comments += m.comments;
      existing.publishes += 1;
      map.set(date, existing);
    }

    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  private analyzeTagPerformance(metrics: ContentMetrics[]): TagPerformance[] {
    const tagMap = new Map<string, { views: number[]; engagement: number[]; count: number }>();

    for (const m of metrics) {
      const tags = this.data.tags[m.contentId] || [];
      for (const tag of tags) {
        const existing = tagMap.get(tag) || { views: [], engagement: [], count: 0 };
        existing.views.push(m.views);
        existing.engagement.push(m.likes + m.comments + m.shares);
        existing.count++;
        tagMap.set(tag, existing);
      }
    }

    return Array.from(tagMap.entries())
      .map(([tag, data]) => ({
        tag,
        usageCount: data.count,
        avgViews: Math.round(data.views.reduce((s, v) => s + v, 0) / data.count),
        avgEngagement: Math.round(data.engagement.reduce((s, v) => s + v, 0) / data.count),
      }))
      .sort((a, b) => b.avgEngagement - a.avgEngagement);
  }

  // ==================== 持久化 ====================

  private load(): void {
    try {
      if (fs.existsSync(this.config.dataPath)) {
        const raw = fs.readFileSync(this.config.dataPath, "utf-8");
        this.data = JSON.parse(raw);
      }
    } catch {
      this.data = { metrics: [], tags: {} };
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(this.config.dataPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.config.dataPath, JSON.stringify(this.data, null, 2));
    } catch {
      // 静默处理
    }
  }
}
