/**
 * Quality 模块 — 内容质量引擎
 *
 * - QualityEngine: 多维度评分 + 原创检测 + 自动优化
 */

export { QualityEngine } from "./engine.js";
export type {
  QualityEngineConfig,
  QualityScoreResult,
  DimensionScore,
  QualityDimension,
  Recommendation,
  OriginalityResult,
  SuspiciousFragment,
  OptimizeOptions,
  OptimizeResult,
} from "./types.js";
