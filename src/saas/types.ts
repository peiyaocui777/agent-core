/**
 * SaaS 多租户架构类型定义
 *
 * 用户账户 → API Key → 配额限制 → 计费模型
 */

// ==================== 用户/租户 ====================

/** 套餐计划 */
export type PlanTier = "free" | "starter" | "pro" | "enterprise";

/** 用户账户 */
export interface TenantAccount {
  id: string;
  email: string;
  name: string;
  plan: PlanTier;
  /** API Keys */
  apiKeys: ApiKeyInfo[];
  /** 创建时间 */
  createdAt: string;
  /** 最后活跃 */
  lastActiveAt: string;
  /** 状态 */
  status: "active" | "suspended" | "deleted";
  /** 自定义设置 */
  settings: TenantSettings;
}

/** API Key */
export interface ApiKeyInfo {
  key: string;
  name: string;
  createdAt: string;
  lastUsedAt?: string;
  expiresAt?: string;
  permissions: ApiPermission[];
  /** 速率限制覆盖 */
  rateLimitOverride?: number;
}

/** API 权限 */
export type ApiPermission =
  | "read"
  | "write"
  | "publish"
  | "admin"
  | "analytics"
  | "marketplace";

/** 租户设置 */
export interface TenantSettings {
  /** 默认 LLM 提供商 */
  llmProvider?: string;
  /** 默认安全级别 */
  safetyLevel?: "strict" | "moderate" | "loose";
  /** 启用的平台 */
  enabledPlatforms?: string[];
  /** 自定义 Webhook URL */
  webhookUrl?: string;
  /** 时区 */
  timezone?: string;
}

// ==================== 配额 ====================

/** 配额项 */
export type QuotaType =
  | "api_calls"       // API 调用次数
  | "publishes"       // 发布次数
  | "ai_tokens"       // LLM Token 消耗
  | "storage_mb"      // 存储空间 MB
  | "skills"          // 最大 Skill 数
  | "workflows"       // Workflow 执行次数
  | "agents"          // Multi-Agent 任务数
  | "scrapes";        // 采集次数

/** 配额限制 */
export interface QuotaLimit {
  type: QuotaType;
  /** 每月配额 */
  monthlyLimit: number;
  /** 当月已用 */
  used: number;
  /** 重置时间 */
  resetAt: string;
}

/** 套餐配额定义 */
export interface PlanQuotas {
  plan: PlanTier;
  quotas: Record<QuotaType, number>;
  /** 价格（分/月） */
  priceCents: number;
  /** 功能标志 */
  features: string[];
}

// ==================== 计费 ====================

/** 用量记录 */
export interface UsageRecord {
  tenantId: string;
  type: QuotaType;
  amount: number;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

/** 月度账单 */
export interface MonthlyBill {
  tenantId: string;
  period: string; // YYYY-MM
  plan: PlanTier;
  basePriceCents: number;
  overageCharges: OverageCharge[];
  totalCents: number;
  status: "pending" | "paid" | "overdue";
}

/** 超额费用 */
export interface OverageCharge {
  type: QuotaType;
  overageAmount: number;
  unitPriceCents: number;
  totalCents: number;
}

// ==================== SaaS 管理器配置 ====================

export interface SaasConfig {
  /** 数据存储路径 */
  dataPath: string;
}
