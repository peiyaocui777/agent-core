/**
 * Safety Engine — 四层风控引擎
 *
 * 1. 内容安全审核（敏感词 + AI 审核）
 * 2. 频率限制（滑动窗口限速）
 * 3. 平台合规校验
 * 4. 反封策略（随机延迟 + 活跃时段 + 冷却机制）
 */

import type {
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

// ==================== 默认敏感词库 ====================

const DEFAULT_SENSITIVE_WORDS: Record<ViolationType, string[]> = {
  political: [
    "翻墙", "VPN", "六四", "天安门事件", "法轮功",
    "达赖", "藏独", "台独", "港独", "颜色革命",
  ],
  pornographic: [
    "色情", "裸体", "性服务", "约炮", "一夜情",
  ],
  violence: [
    "自杀方法", "制造炸弹", "杀人教程",
  ],
  fraud: [
    "日赚万元", "躺赚", "稳赚不赔", "0 投资", "白嫖赚钱",
    "刷单", "传销", "庞氏骗局",
  ],
  spam: [
    "加微信", "加 V", "私信领取", "点击链接", "扫码领取",
    "免费领", "限时福利",
  ],
  copyright: [],
  personal_info: [
    "身份证号", "银行卡号", "手机号码",
  ],
  illegal_promotion: [
    "代购", "仿品", "高仿", "A 货",
  ],
  sensitive_word: [],
  platform_violation: [],
};

// ==================== 默认平台规则 ====================

const DEFAULT_PLATFORM_RULES: PlatformRule[] = [
  {
    platform: "xiaohongshu",
    titleMaxLength: 20,
    contentMaxLength: 1000,
    maxTags: 10,
    maxImages: 18,
    requiredFields: ["title", "content"],
  },
  {
    platform: "wechat",
    titleMaxLength: 64,
    contentMaxLength: 20000,
    maxImages: 20,
    requiredFields: ["title", "content"],
  },
  {
    platform: "douyin",
    titleMaxLength: 55,
    contentMaxLength: 300,
    maxTags: 5,
    maxImages: 12,
    requiredFields: ["title"],
  },
  {
    platform: "bilibili",
    titleMaxLength: 80,
    contentMaxLength: 10000,
    maxTags: 12,
    requiredFields: ["title", "content"],
  },
  {
    platform: "weibo",
    contentMaxLength: 2000,
    maxImages: 9,
    maxTags: 9,
  },
  {
    platform: "zhihu",
    titleMaxLength: 100,
    contentMaxLength: 50000,
    maxTags: 5,
    requiredFields: ["title", "content"],
  },
];

// ==================== 默认频率限制 ====================

const DEFAULT_RATE_LIMITS: RateLimit[] = [
  { platform: "xiaohongshu", windowMs: 3600000, maxRequests: 5, action: "publish" },
  { platform: "xiaohongshu", windowMs: 86400000, maxRequests: 15, action: "publish" },
  { platform: "wechat", windowMs: 86400000, maxRequests: 8, action: "publish" },
  { platform: "douyin", windowMs: 3600000, maxRequests: 3, action: "publish" },
  { platform: "bilibili", windowMs: 86400000, maxRequests: 10, action: "publish" },
  { platform: "weibo", windowMs: 3600000, maxRequests: 10, action: "publish" },
  { platform: "*", windowMs: 60000, maxRequests: 30, action: "api_call" },
  { platform: "*", windowMs: 60000, maxRequests: 10, action: "scrape" },
];

// ==================== 默认反封配置 ====================

const DEFAULT_ANTI_BLOCK: AntiBlockConfig = {
  randomDelayRange: [2000, 8000],
  dailyPublishLimit: 30,
  activeHours: [8, 23],
  rotateUserAgent: true,
  rotateProxy: false,
  failureCooldownMs: 300000, // 5 分钟
  maxConsecutiveFailures: 3,
};

// ==================== Safety Engine ====================

export class SafetyEngine {
  private config: SafetyEngineConfig;
  private sensitiveWords: Map<ViolationType, Set<string>>;
  private whitelistWords: Set<string>;
  private platformRules: Map<string, PlatformRule>;
  private rateLimits: RateLimit[];
  private antiBlock: AntiBlockConfig;

  /** 频率计数器: key → { timestamps } */
  private rateCounters: Map<string, number[]> = new Map();
  /** 每日发布计数 */
  private dailyPublishCount = 0;
  private lastResetDate = "";
  /** 连续失败计数器 */
  private consecutiveFailures: Map<string, number> = new Map();

  constructor(config?: Partial<SafetyEngineConfig>) {
    this.config = {
      level: "moderate",
      enableAIReview: false,
      ...config,
    };

    // 初始化敏感词
    this.sensitiveWords = new Map();
    for (const [type, words] of Object.entries(DEFAULT_SENSITIVE_WORDS)) {
      this.sensitiveWords.set(type as ViolationType, new Set(words));
    }
    // 添加自定义敏感词
    if (config?.customSensitiveWords) {
      const customSet = this.sensitiveWords.get("sensitive_word") || new Set();
      for (const word of config.customSensitiveWords) {
        customSet.add(word);
      }
      this.sensitiveWords.set("sensitive_word", customSet);
    }

    this.whitelistWords = new Set(config?.whitelistWords || []);

    // 平台规则
    this.platformRules = new Map();
    for (const rule of DEFAULT_PLATFORM_RULES) {
      this.platformRules.set(rule.platform, rule);
    }
    if (config?.platformRules) {
      for (const rule of config.platformRules) {
        this.platformRules.set(rule.platform, rule);
      }
    }

    // 频率限制
    this.rateLimits = config?.rateLimits || DEFAULT_RATE_LIMITS;

    // 反封配置
    this.antiBlock = { ...DEFAULT_ANTI_BLOCK, ...config?.antiBlock };
  }

  // ==================== 1. 内容安全审核 ====================

  /**
   * 全面内容安全检查
   * 包括敏感词、违规内容、个人信息等
   */
  checkContent(content: string, title?: string): SafetyCheckResult {
    const start = Date.now();
    const text = `${title || ""} ${content}`.toLowerCase();
    const violations: Violation[] = [];

    // 逐类别扫描敏感词
    for (const [type, words] of this.sensitiveWords) {
      for (const word of words) {
        if (this.whitelistWords.has(word)) continue;

        const lowerWord = word.toLowerCase();
        const idx = text.indexOf(lowerWord);
        if (idx !== -1) {
          const severity = this.getSeverity(type as ViolationType);
          violations.push({
            type: type as ViolationType,
            severity,
            description: `检测到${this.getTypeName(type as ViolationType)}内容`,
            snippet: text.slice(Math.max(0, idx - 10), idx + word.length + 10),
            replacement: "*".repeat(word.length),
          });
        }
      }
    }

    // 检测手机号
    const phoneRegex = /1[3-9]\d{9}/g;
    if (phoneRegex.test(text)) {
      violations.push({
        type: "personal_info",
        severity: "high",
        description: "检测到手机号码",
        snippet: text.match(phoneRegex)?.[0],
        replacement: "1xx****xxxx",
      });
    }

    // 检测身份证号
    const idCardRegex = /\d{17}[\dXx]/g;
    if (idCardRegex.test(text)) {
      violations.push({
        type: "personal_info",
        severity: "critical",
        description: "检测到身份证号码",
      });
    }

    // 检测 URL（部分平台禁止外链）
    const urlRegex = /https?:\/\/[^\s]+/gi;
    const urls = text.match(urlRegex);
    if (urls && urls.length > 3) {
      violations.push({
        type: "spam",
        severity: "medium",
        description: `检测到过多外链 (${urls.length} 个)`,
      });
    }

    // 计算风险分数
    const riskScore = this.calculateRiskScore(violations);
    const action = this.determineAction(riskScore);

    return {
      passed: action === "allow",
      riskScore,
      violations,
      action,
      suggestions: this.generateSuggestions(violations),
      checkTimeMs: Date.now() - start,
    };
  }

  /**
   * 过滤/替换内容中的违规部分
   * 返回清理后的内容
   */
  sanitizeContent(content: string): { cleaned: string; replacements: number } {
    let cleaned = content;
    let replacements = 0;

    for (const [_type, words] of this.sensitiveWords) {
      for (const word of words) {
        if (this.whitelistWords.has(word)) continue;
        const regex = new RegExp(this.escapeRegex(word), "gi");
        const before = cleaned;
        cleaned = cleaned.replace(regex, "*".repeat(word.length));
        if (cleaned !== before) replacements++;
      }
    }

    // 替换手机号
    cleaned = cleaned.replace(/1[3-9]\d{9}/g, () => {
      replacements++;
      return "1xx****xxxx";
    });

    return { cleaned, replacements };
  }

  // ==================== 2. 频率控制 ====================

  /**
   * 检查频率是否允许
   */
  checkRateLimit(platform: string, action: RateLimit["action"]): RateLimitResult {
    const now = Date.now();

    // 查找匹配的规则（平台特定 + 通配符）
    const rules = this.rateLimits.filter(
      (r) => (r.platform === platform || r.platform === "*") && r.action === action
    );

    for (const rule of rules) {
      const key = `${rule.platform}:${rule.action}:${rule.windowMs}`;
      const timestamps = this.rateCounters.get(key) || [];

      // 清理过期的时间戳
      const windowStart = now - rule.windowMs;
      const active = timestamps.filter((t) => t > windowStart);
      this.rateCounters.set(key, active);

      if (active.length >= rule.maxRequests) {
        const oldestActive = active[0];
        const resetAt = new Date(oldestActive + rule.windowMs);
        return {
          allowed: false,
          remaining: 0,
          resetAt,
          retryAfterMs: resetAt.getTime() - now,
        };
      }
    }

    return {
      allowed: true,
      remaining: rules.length > 0
        ? Math.min(
            ...rules.map((r) => {
              const key = `${r.platform}:${r.action}:${r.windowMs}`;
              const count = (this.rateCounters.get(key) || []).length;
              return r.maxRequests - count;
            })
          )
        : 999,
      resetAt: new Date(now + (rules[0]?.windowMs || 60000)),
    };
  }

  /** 记录一次操作（用于频率计数） */
  recordAction(platform: string, action: RateLimit["action"]): void {
    const now = Date.now();
    const rules = this.rateLimits.filter(
      (r) => (r.platform === platform || r.platform === "*") && r.action === action
    );

    for (const rule of rules) {
      const key = `${rule.platform}:${rule.action}:${rule.windowMs}`;
      const timestamps = this.rateCounters.get(key) || [];
      timestamps.push(now);
      this.rateCounters.set(key, timestamps);
    }

    if (action === "publish") {
      this.dailyPublishCount++;
    }
  }

  // ==================== 3. 平台合规校验 ====================

  /**
   * 校验内容是否符合平台规则
   */
  checkPlatformRules(
    platform: string,
    data: {
      title?: string;
      content?: string;
      tags?: string[];
      images?: string[];
    }
  ): PlatformCheckResult {
    const rule = this.platformRules.get(platform);
    if (!rule) {
      return { passed: true, platform, issues: [] };
    }

    const issues: PlatformCheckResult["issues"] = [];

    // 标题长度
    if (rule.titleMaxLength && data.title && data.title.length > rule.titleMaxLength) {
      issues.push({
        field: "title",
        rule: "titleMaxLength",
        message: `标题超过 ${rule.titleMaxLength} 字 (当前 ${data.title.length} 字)`,
      });
    }

    // 内容长度
    if (rule.contentMaxLength && data.content && data.content.length > rule.contentMaxLength) {
      issues.push({
        field: "content",
        rule: "contentMaxLength",
        message: `内容超过 ${rule.contentMaxLength} 字 (当前 ${data.content.length} 字)`,
      });
    }

    // 标签数量
    if (rule.maxTags && data.tags && data.tags.length > rule.maxTags) {
      issues.push({
        field: "tags",
        rule: "maxTags",
        message: `标签超过 ${rule.maxTags} 个 (当前 ${data.tags.length} 个)`,
      });
    }

    // 图片数量
    if (rule.maxImages && data.images && data.images.length > rule.maxImages) {
      issues.push({
        field: "images",
        rule: "maxImages",
        message: `图片超过 ${rule.maxImages} 张 (当前 ${data.images.length} 张)`,
      });
    }

    // 必填字段
    if (rule.requiredFields) {
      for (const field of rule.requiredFields) {
        if (!(data as Record<string, unknown>)[field]) {
          issues.push({
            field,
            rule: "required",
            message: `${field} 为必填字段`,
          });
        }
      }
    }

    return {
      passed: issues.length === 0,
      platform,
      issues,
    };
  }

  /** 获取平台规则 */
  getPlatformRule(platform: string): PlatformRule | undefined {
    return this.platformRules.get(platform);
  }

  /** 列出所有平台规则 */
  listPlatformRules(): PlatformRule[] {
    return Array.from(this.platformRules.values());
  }

  // ==================== 4. 反封策略 ====================

  /**
   * 获取发布前需要等待的随机延迟（毫秒）
   */
  getRandomDelay(): number {
    const [min, max] = this.antiBlock.randomDelayRange;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * 检查当前时间是否在活跃时段
   */
  isActiveHour(): boolean {
    const hour = new Date().getHours();
    const [start, end] = this.antiBlock.activeHours;
    return hour >= start && hour <= end;
  }

  /**
   * 检查是否超过每日发布上限
   */
  checkDailyLimit(): { allowed: boolean; remaining: number } {
    const today = new Date().toISOString().slice(0, 10);
    if (this.lastResetDate !== today) {
      this.dailyPublishCount = 0;
      this.lastResetDate = today;
    }

    return {
      allowed: this.dailyPublishCount < this.antiBlock.dailyPublishLimit,
      remaining: Math.max(0, this.antiBlock.dailyPublishLimit - this.dailyPublishCount),
    };
  }

  /**
   * 记录失败并检查是否需要冷却
   */
  recordFailure(platform: string): { needsCooldown: boolean; cooldownMs: number } {
    const count = (this.consecutiveFailures.get(platform) || 0) + 1;
    this.consecutiveFailures.set(platform, count);

    return {
      needsCooldown: count >= this.antiBlock.maxConsecutiveFailures,
      cooldownMs: this.antiBlock.failureCooldownMs,
    };
  }

  /** 重置失败计数 */
  resetFailure(platform: string): void {
    this.consecutiveFailures.set(platform, 0);
  }

  /**
   * 综合预发布检查
   * 集成所有安全层，返回最终决策
   */
  async prePublishCheck(
    platform: string,
    data: { title?: string; content?: string; tags?: string[]; images?: string[] }
  ): Promise<{
    allowed: boolean;
    reasons: string[];
    delayMs: number;
    contentCheck: SafetyCheckResult;
    platformCheck: PlatformCheckResult;
    rateCheck: RateLimitResult;
    dailyCheck: { allowed: boolean; remaining: number };
  }> {
    const reasons: string[] = [];

    // 1. 内容安全
    const contentCheck = this.checkContent(data.content || "", data.title);
    if (!contentCheck.passed) {
      reasons.push(`内容安全: ${contentCheck.violations.map((v) => v.description).join(", ")}`);
    }

    // 2. 平台合规
    const platformCheck = this.checkPlatformRules(platform, data);
    if (!platformCheck.passed) {
      reasons.push(`平台合规: ${platformCheck.issues.map((i) => i.message).join(", ")}`);
    }

    // 3. 频率限制
    const rateCheck = this.checkRateLimit(platform, "publish");
    if (!rateCheck.allowed) {
      reasons.push(`频率限制: 请等待 ${Math.ceil((rateCheck.retryAfterMs || 0) / 1000)}s`);
    }

    // 4. 每日上限
    const dailyCheck = this.checkDailyLimit();
    if (!dailyCheck.allowed) {
      reasons.push(`每日上限: 已达 ${this.antiBlock.dailyPublishLimit} 次`);
    }

    // 5. 活跃时段
    if (!this.isActiveHour()) {
      reasons.push(`非活跃时段: 建议在 ${this.antiBlock.activeHours[0]}:00-${this.antiBlock.activeHours[1]}:00 发布`);
    }

    const allowed = reasons.length === 0;
    const delayMs = allowed ? this.getRandomDelay() : 0;

    return {
      allowed,
      reasons,
      delayMs,
      contentCheck,
      platformCheck,
      rateCheck,
      dailyCheck,
    };
  }

  // ==================== 统计与配置 ====================

  /** 获取风控状态摘要 */
  getStatus(): {
    level: SafetyLevel;
    sensitiveWordCount: number;
    platformRuleCount: number;
    rateLimitCount: number;
    dailyPublishCount: number;
    dailyPublishLimit: number;
    activeHours: [number, number];
  } {
    let wordCount = 0;
    for (const words of this.sensitiveWords.values()) {
      wordCount += words.size;
    }

    return {
      level: this.config.level,
      sensitiveWordCount: wordCount,
      platformRuleCount: this.platformRules.size,
      rateLimitCount: this.rateLimits.length,
      dailyPublishCount: this.dailyPublishCount,
      dailyPublishLimit: this.antiBlock.dailyPublishLimit,
      activeHours: this.antiBlock.activeHours,
    };
  }

  /** 添加自定义敏感词 */
  addSensitiveWord(word: string, type: ViolationType = "sensitive_word"): void {
    const words = this.sensitiveWords.get(type) || new Set();
    words.add(word);
    this.sensitiveWords.set(type, words);
  }

  /** 添加白名单词 */
  addWhitelistWord(word: string): void {
    this.whitelistWords.add(word);
  }

  // ==================== 内部辅助 ====================

  private getSeverity(type: ViolationType): Violation["severity"] {
    const severityMap: Record<ViolationType, Violation["severity"]> = {
      political: "critical",
      pornographic: "critical",
      violence: "critical",
      fraud: "high",
      personal_info: "high",
      illegal_promotion: "high",
      spam: "medium",
      copyright: "medium",
      sensitive_word: "medium",
      platform_violation: "low",
    };
    return severityMap[type] || "medium";
  }

  private getTypeName(type: ViolationType): string {
    const nameMap: Record<ViolationType, string> = {
      political: "政治敏感",
      pornographic: "色情低俗",
      violence: "暴力血腥",
      fraud: "诈骗引导",
      personal_info: "个人隐私",
      illegal_promotion: "违规推广",
      spam: "垃圾广告",
      copyright: "版权侵权",
      sensitive_word: "敏感词",
      platform_violation: "平台违规",
    };
    return nameMap[type] || type;
  }

  private calculateRiskScore(violations: Violation[]): number {
    let score = 0;
    for (const v of violations) {
      switch (v.severity) {
        case "critical": score += 40; break;
        case "high": score += 25; break;
        case "medium": score += 15; break;
        case "low": score += 5; break;
      }
    }
    return Math.min(100, score);
  }

  private determineAction(riskScore: number): SafetyCheckResult["action"] {
    const thresholds: Record<SafetyLevel, { review: number; block: number }> = {
      strict: { review: 10, block: 30 },
      moderate: { review: 25, block: 50 },
      loose: { review: 40, block: 70 },
    };

    const t = thresholds[this.config.level];
    if (riskScore >= t.block) return "block";
    if (riskScore >= t.review) return "review";
    return "allow";
  }

  private generateSuggestions(violations: Violation[]): string[] {
    const suggestions: string[] = [];

    for (const v of violations) {
      if (v.replacement) {
        suggestions.push(`将 "${v.snippet}" 替换为 "${v.replacement}"`);
      }
      if (v.type === "spam") {
        suggestions.push("减少外链数量，避免营销导流词汇");
      }
      if (v.type === "personal_info") {
        suggestions.push("移除个人隐私信息（手机号、身份证等）");
      }
    }

    return [...new Set(suggestions)];
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
