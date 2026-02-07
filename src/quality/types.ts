/**
 * 内容质量引擎类型定义
 *
 * AI 审核 + 原创检测 + 质量评分 + 自动优化建议
 */

// ==================== 质量评分 ====================

/** 质量维度 */
export type QualityDimension =
  | "readability"     // 可读性
  | "originality"     // 原创性
  | "engagement"      // 互动潜力
  | "value"           // 内容价值
  | "structure"       // 结构完整性
  | "expression"      // 表达力
  | "compliance";     // 合规性

/** 单维度评分 */
export interface DimensionScore {
  dimension: QualityDimension;
  score: number; // 0-100
  label: string;
  feedback: string;
  suggestions: string[];
}

/** 质量评分结果 */
export interface QualityScoreResult {
  /** 总分（0-100） */
  totalScore: number;
  /** 等级 */
  grade: "S" | "A" | "B" | "C" | "D";
  /** 各维度评分 */
  dimensions: DimensionScore[];
  /** 综合评语 */
  summary: string;
  /** 优化建议（按优先级） */
  recommendations: Recommendation[];
  /** 评分时间 */
  scoredAt: string;
}

/** 优化建议 */
export interface Recommendation {
  priority: "high" | "medium" | "low";
  dimension: QualityDimension;
  action: string;
  reason: string;
  example?: string;
}

// ==================== 原创检测 ====================

/** 原创检测结果 */
export interface OriginalityResult {
  /** 原创度（0-100，100 = 完全原创） */
  originalityScore: number;
  /** 是否可能是 AI 生成 */
  aiGeneratedProbability: number;
  /** 疑似引用/重复的片段 */
  suspiciousFragments: SuspiciousFragment[];
  /** 通过检测 */
  passed: boolean;
}

/** 疑似重复片段 */
export interface SuspiciousFragment {
  text: string;
  startIndex: number;
  endIndex: number;
  reason: string;
  similarity: number;
}

// ==================== 自动优化 ====================

/** 优化选项 */
export interface OptimizeOptions {
  /** 目标平台 */
  platform?: string;
  /** 目标风格 */
  style?: "casual" | "professional" | "storytelling" | "educational";
  /** 目标字数范围 */
  targetLength?: [number, number];
  /** 目标关键词 */
  targetKeywords?: string[];
  /** 是否添加 Emoji */
  addEmoji?: boolean;
  /** 是否添加话题标签 */
  addHashtags?: boolean;
}

/** 优化结果 */
export interface OptimizeResult {
  /** 优化后的标题 */
  optimizedTitle: string;
  /** 优化后的正文 */
  optimizedContent: string;
  /** 优化说明 */
  changes: string[];
  /** 优化前后得分对比 */
  beforeScore: number;
  afterScore: number;
}

// ==================== 引擎配置 ====================

/** 质量引擎配置 */
export interface QualityEngineConfig {
  /** 原创度阈值（低于此值标记为疑似抄袭） */
  originalityThreshold: number;
  /** AI 生成概率阈值 */
  aiDetectionThreshold: number;
  /** 最低发布质量分 */
  minPublishScore: number;
}
