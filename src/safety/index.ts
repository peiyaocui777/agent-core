/**
 * Safety 模块 — 四层风控引擎
 *
 * - SafetyEngine: 内容安全 + 频率限制 + 平台合规 + 反封策略
 */

export { SafetyEngine } from "./engine.js";
export type {
  SafetyEngineConfig,
  SafetyCheckResult,
  Violation,
  ViolationType,
  SafetyLevel,
  RateLimit,
  RateLimitResult,
  PlatformRule,
  PlatformCheckResult,
  AntiBlockConfig,
} from "./types.js";
