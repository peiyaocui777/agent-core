/**
 * 风控系统类型定义
 *
 * 四层安全防线：
 * 1. 内容安全：敏感词过滤、违规内容检测
 * 2. 频率控制：单平台发布限速、全局 QPS
 * 3. 平台合规：各平台特有规则校验
 * 4. 反封策略：行为模拟、时间随机化、账号轮换
 */

// ==================== 内容安全 ====================

/** 安全检查级别 */
export type SafetyLevel = "strict" | "moderate" | "loose";

/** 违规类型 */
export type ViolationType =
  | "sensitive_word"     // 敏感词
  | "political"          // 政治敏感
  | "pornographic"       // 色情低俗
  | "violence"           // 暴力血腥
  | "fraud"              // 诈骗引导
  | "spam"               // 垃圾广告
  | "copyright"          // 版权侵权
  | "personal_info"      // 个人隐私
  | "illegal_promotion"  // 违规推广
  | "platform_violation"; // 平台特有违规

/** 检查结果 */
export interface SafetyCheckResult {
  /** 是否通过 */
  passed: boolean;
  /** 风险分数（0-100，越高越危险） */
  riskScore: number;
  /** 检测到的违规项 */
  violations: Violation[];
  /** 建议动作 */
  action: "allow" | "review" | "block";
  /** 修改建议 */
  suggestions?: string[];
  /** 检查耗时 ms */
  checkTimeMs: number;
}

/** 单条违规 */
export interface Violation {
  type: ViolationType;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  /** 违规内容片段 */
  snippet?: string;
  /** 建议替换 */
  replacement?: string;
}

// ==================== 频率控制 ====================

/** 频率规则 */
export interface RateLimit {
  /** 平台名 */
  platform: string;
  /** 时间窗口（毫秒） */
  windowMs: number;
  /** 窗口内最大操作数 */
  maxRequests: number;
  /** 操作类型 */
  action: "publish" | "search" | "scrape" | "api_call";
}

/** 频率检查结果 */
export interface RateLimitResult {
  allowed: boolean;
  /** 剩余次数 */
  remaining: number;
  /** 重置时间 */
  resetAt: Date;
  /** 需要等待的毫秒数（如被限制） */
  retryAfterMs?: number;
}

// ==================== 平台合规 ====================

/** 平台规则 */
export interface PlatformRule {
  platform: string;
  /** 标题长度限制 */
  titleMaxLength?: number;
  /** 内容长度限制 */
  contentMaxLength?: number;
  /** 标签数量限制 */
  maxTags?: number;
  /** 图片数量限制 */
  maxImages?: number;
  /** 禁止的内容格式 */
  forbiddenFormats?: string[];
  /** 必填字段 */
  requiredFields?: string[];
  /** 自定义校验规则 */
  customRules?: Array<{
    name: string;
    description: string;
    check: string; // 表达式
  }>;
}

/** 平台校验结果 */
export interface PlatformCheckResult {
  passed: boolean;
  platform: string;
  issues: Array<{
    field: string;
    rule: string;
    message: string;
  }>;
}

// ==================== 反封策略 ====================

/** 反封配置 */
export interface AntiBlockConfig {
  /** 操作间随机延迟范围 [min, max] 毫秒 */
  randomDelayRange: [number, number];
  /** 每日最大发布数 */
  dailyPublishLimit: number;
  /** 活跃时间段 [startHour, endHour] */
  activeHours: [number, number];
  /** 是否启用 User-Agent 轮换 */
  rotateUserAgent: boolean;
  /** 是否启用代理 IP 轮换 */
  rotateProxy: boolean;
  /** 发布失败后冷却时间（毫秒） */
  failureCooldownMs: number;
  /** 连续失败最大次数（超过则暂停） */
  maxConsecutiveFailures: number;
}

// ==================== 风控引擎配置 ====================

/** 风控引擎配置 */
export interface SafetyEngineConfig {
  /** 安全检查级别 */
  level: SafetyLevel;
  /** 自定义敏感词列表 */
  customSensitiveWords?: string[];
  /** 白名单词（不触发过滤） */
  whitelistWords?: string[];
  /** 频率限制规则 */
  rateLimits?: RateLimit[];
  /** 平台规则 */
  platformRules?: PlatformRule[];
  /** 反封配置 */
  antiBlock?: Partial<AntiBlockConfig>;
  /** 是否启用 AI 审核（需要 LLM） */
  enableAIReview?: boolean;
}
