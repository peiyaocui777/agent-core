/**
 * TenantManager — SaaS 多租户管理器
 *
 * 1. 用户注册/认证/管理
 * 2. API Key 生成/验证/吊销
 * 3. 配额追踪/限制
 * 4. 用量记录/计费
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import type {
  SaasConfig,
  TenantAccount,
  ApiKeyInfo,
  ApiPermission,
  PlanTier,
  QuotaType,
  QuotaLimit,
  PlanQuotas,
  UsageRecord,
  MonthlyBill,
  OverageCharge,
  TenantSettings,
} from "./types.js";

// ==================== 默认套餐配额 ====================

const PLAN_DEFINITIONS: PlanQuotas[] = [
  {
    plan: "free",
    priceCents: 0,
    quotas: {
      api_calls: 1000,
      publishes: 30,
      ai_tokens: 100000,
      storage_mb: 100,
      skills: 5,
      workflows: 10,
      agents: 5,
      scrapes: 50,
    },
    features: ["basic_publish", "basic_analytics"],
  },
  {
    plan: "starter",
    priceCents: 2900, // $29/月
    quotas: {
      api_calls: 10000,
      publishes: 200,
      ai_tokens: 1000000,
      storage_mb: 1024,
      skills: 20,
      workflows: 100,
      agents: 30,
      scrapes: 500,
    },
    features: ["basic_publish", "basic_analytics", "multi_platform", "quality_check", "safety_check"],
  },
  {
    plan: "pro",
    priceCents: 9900, // $99/月
    quotas: {
      api_calls: 100000,
      publishes: 1000,
      ai_tokens: 10000000,
      storage_mb: 10240,
      skills: 100,
      workflows: 1000,
      agents: 200,
      scrapes: 5000,
    },
    features: [
      "basic_publish", "basic_analytics", "multi_platform",
      "quality_check", "safety_check", "multi_agent", "workflow_engine",
      "browser_automation", "marketplace", "priority_support",
    ],
  },
  {
    plan: "enterprise",
    priceCents: 49900, // $499/月
    quotas: {
      api_calls: -1, // 无限
      publishes: -1,
      ai_tokens: -1,
      storage_mb: 102400,
      skills: -1,
      workflows: -1,
      agents: -1,
      scrapes: -1,
    },
    features: [
      "basic_publish", "basic_analytics", "multi_platform",
      "quality_check", "safety_check", "multi_agent", "workflow_engine",
      "browser_automation", "marketplace", "priority_support",
      "custom_domain", "sla_guarantee", "dedicated_support", "white_label",
    ],
  },
];

// ==================== 超额单价（分/单位） ====================

const OVERAGE_PRICES: Record<QuotaType, number> = {
  api_calls: 1,       // $0.01/次
  publishes: 10,      // $0.10/次
  ai_tokens: 0,       // 按 LLM 实际计费
  storage_mb: 5,      // $0.05/MB
  skills: 100,        // $1.00/个
  workflows: 5,       // $0.05/次
  agents: 10,         // $0.10/次
  scrapes: 2,         // $0.02/次
};

// ==================== 持久化数据 ====================

interface SaasData {
  tenants: TenantAccount[];
  usage: UsageRecord[];
  bills: MonthlyBill[];
}

// ==================== TenantManager ====================

export class TenantManager {
  private config: SaasConfig;
  private data: SaasData = { tenants: [], usage: [], bills: [] };
  private tenantMap = new Map<string, TenantAccount>();
  private keyMap = new Map<string, string>(); // apiKey → tenantId

  constructor(config?: Partial<SaasConfig>) {
    this.config = {
      dataPath: "/tmp/jarvis-saas.json",
      ...config,
    };
    this.load();
  }

  // ==================== 1. 用户管理 ====================

  /** 注册新用户 */
  createTenant(email: string, name: string, plan: PlanTier = "free"): TenantAccount {
    // 检查邮箱唯一
    if (this.data.tenants.some((t) => t.email === email)) {
      throw new Error(`邮箱已注册: ${email}`);
    }

    const id = `tenant-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const apiKey = this.generateApiKey();

    const tenant: TenantAccount = {
      id,
      email,
      name,
      plan,
      apiKeys: [
        {
          key: apiKey,
          name: "Default Key",
          createdAt: new Date().toISOString(),
          permissions: ["read", "write", "publish"],
        },
      ],
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      status: "active",
      settings: {},
    };

    this.data.tenants.push(tenant);
    this.tenantMap.set(id, tenant);
    this.keyMap.set(apiKey, id);

    // 初始化配额
    this.initQuotas(id, plan);
    this.save();

    return tenant;
  }

  /** 获取用户 */
  getTenant(id: string): TenantAccount | undefined {
    return this.tenantMap.get(id);
  }

  /** 通过邮箱查找 */
  getTenantByEmail(email: string): TenantAccount | undefined {
    return this.data.tenants.find((t) => t.email === email);
  }

  /** 更新套餐 */
  upgradePlan(tenantId: string, newPlan: PlanTier): boolean {
    const tenant = this.tenantMap.get(tenantId);
    if (!tenant) return false;
    tenant.plan = newPlan;
    this.initQuotas(tenantId, newPlan);
    this.save();
    return true;
  }

  /** 暂停账户 */
  suspendTenant(tenantId: string): boolean {
    const tenant = this.tenantMap.get(tenantId);
    if (!tenant) return false;
    tenant.status = "suspended";
    this.save();
    return true;
  }

  /** 更新设置 */
  updateSettings(tenantId: string, settings: Partial<TenantSettings>): boolean {
    const tenant = this.tenantMap.get(tenantId);
    if (!tenant) return false;
    tenant.settings = { ...tenant.settings, ...settings };
    this.save();
    return true;
  }

  /** 列出所有租户 */
  listTenants(): TenantAccount[] {
    return this.data.tenants.filter((t) => t.status !== "deleted");
  }

  // ==================== 2. API Key ====================

  /** 通过 API Key 验证并返回租户 */
  authenticate(apiKey: string): TenantAccount | null {
    const tenantId = this.keyMap.get(apiKey);
    if (!tenantId) return null;

    const tenant = this.tenantMap.get(tenantId);
    if (!tenant || tenant.status !== "active") return null;

    // 检查 key 是否有效
    const keyInfo = tenant.apiKeys.find((k) => k.key === apiKey);
    if (!keyInfo) return null;

    // 检查过期
    if (keyInfo.expiresAt && new Date(keyInfo.expiresAt) < new Date()) return null;

    // 更新最后使用时间
    keyInfo.lastUsedAt = new Date().toISOString();
    tenant.lastActiveAt = new Date().toISOString();

    return tenant;
  }

  /** 创建新 API Key */
  createApiKey(
    tenantId: string,
    name: string,
    permissions: ApiPermission[] = ["read", "write"]
  ): string | null {
    const tenant = this.tenantMap.get(tenantId);
    if (!tenant) return null;

    const key = this.generateApiKey();
    tenant.apiKeys.push({
      key,
      name,
      createdAt: new Date().toISOString(),
      permissions,
    });

    this.keyMap.set(key, tenantId);
    this.save();
    return key;
  }

  /** 吊销 API Key */
  revokeApiKey(tenantId: string, apiKey: string): boolean {
    const tenant = this.tenantMap.get(tenantId);
    if (!tenant) return false;

    const idx = tenant.apiKeys.findIndex((k) => k.key === apiKey);
    if (idx < 0) return false;

    tenant.apiKeys.splice(idx, 1);
    this.keyMap.delete(apiKey);
    this.save();
    return true;
  }

  /** 检查权限 */
  hasPermission(apiKey: string, permission: ApiPermission): boolean {
    const tenantId = this.keyMap.get(apiKey);
    if (!tenantId) return false;

    const tenant = this.tenantMap.get(tenantId);
    if (!tenant) return false;

    const keyInfo = tenant.apiKeys.find((k) => k.key === apiKey);
    if (!keyInfo) return false;

    return keyInfo.permissions.includes(permission) || keyInfo.permissions.includes("admin");
  }

  // ==================== 3. 配额管理 ====================

  /** 检查配额是否允许 */
  checkQuota(tenantId: string, type: QuotaType, amount = 1): { allowed: boolean; remaining: number } {
    const tenant = this.tenantMap.get(tenantId);
    if (!tenant) return { allowed: false, remaining: 0 };

    const planDef = PLAN_DEFINITIONS.find((p) => p.plan === tenant.plan);
    if (!planDef) return { allowed: false, remaining: 0 };

    const limit = planDef.quotas[type];
    if (limit === -1) return { allowed: true, remaining: 999999 }; // 无限

    // 当月用量
    const monthUsed = this.getMonthlyUsage(tenantId, type);
    const remaining = limit - monthUsed;

    return {
      allowed: remaining >= amount,
      remaining: Math.max(0, remaining),
    };
  }

  /** 记录用量 */
  recordUsage(tenantId: string, type: QuotaType, amount = 1, metadata?: Record<string, unknown>): void {
    this.data.usage.push({
      tenantId,
      type,
      amount,
      timestamp: new Date().toISOString(),
      metadata,
    });
    this.save();
  }

  /** 获取当月用量 */
  getMonthlyUsage(tenantId: string, type?: QuotaType): number {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    return this.data.usage
      .filter(
        (u) =>
          u.tenantId === tenantId &&
          (!type || u.type === type) &&
          new Date(u.timestamp) >= monthStart
      )
      .reduce((sum, u) => sum + u.amount, 0);
  }

  /** 获取所有配额状态 */
  getQuotaStatus(tenantId: string): QuotaLimit[] {
    const tenant = this.tenantMap.get(tenantId);
    if (!tenant) return [];

    const planDef = PLAN_DEFINITIONS.find((p) => p.plan === tenant.plan);
    if (!planDef) return [];

    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    return Object.entries(planDef.quotas).map(([type, limit]) => ({
      type: type as QuotaType,
      monthlyLimit: limit,
      used: this.getMonthlyUsage(tenantId, type as QuotaType),
      resetAt: nextMonth.toISOString(),
    }));
  }

  // ==================== 4. 计费 ====================

  /** 生成月度账单 */
  generateBill(tenantId: string, period?: string): MonthlyBill | null {
    const tenant = this.tenantMap.get(tenantId);
    if (!tenant) return null;

    const planDef = PLAN_DEFINITIONS.find((p) => p.plan === tenant.plan);
    if (!planDef) return null;

    const now = new Date();
    const billPeriod = period || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const overageCharges: OverageCharge[] = [];

    for (const [type, limit] of Object.entries(planDef.quotas)) {
      if (limit === -1) continue; // 无限，不计超额

      const used = this.getMonthlyUsage(tenantId, type as QuotaType);
      if (used > limit) {
        const overage = used - limit;
        const unitPrice = OVERAGE_PRICES[type as QuotaType] || 0;
        overageCharges.push({
          type: type as QuotaType,
          overageAmount: overage,
          unitPriceCents: unitPrice,
          totalCents: overage * unitPrice,
        });
      }
    }

    const bill: MonthlyBill = {
      tenantId,
      period: billPeriod,
      plan: tenant.plan,
      basePriceCents: planDef.priceCents,
      overageCharges,
      totalCents: planDef.priceCents + overageCharges.reduce((s, c) => s + c.totalCents, 0),
      status: "pending",
    };

    this.data.bills.push(bill);
    this.save();
    return bill;
  }

  /** 获取历史账单 */
  getBills(tenantId: string): MonthlyBill[] {
    return this.data.bills.filter((b) => b.tenantId === tenantId);
  }

  // ==================== 5. 套餐信息 ====================

  /** 获取所有套餐定义 */
  getPlans(): PlanQuotas[] {
    return PLAN_DEFINITIONS;
  }

  /** 获取指定套餐 */
  getPlan(tier: PlanTier): PlanQuotas | undefined {
    return PLAN_DEFINITIONS.find((p) => p.plan === tier);
  }

  // ==================== 统计 ====================

  getStatus(): {
    totalTenants: number;
    activeTenants: number;
    planDistribution: Record<string, number>;
    totalUsageThisMonth: number;
  } {
    const active = this.data.tenants.filter((t) => t.status === "active");
    const planDist: Record<string, number> = {};
    for (const t of active) {
      planDist[t.plan] = (planDist[t.plan] || 0) + 1;
    }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthUsage = this.data.usage.filter(
      (u) => new Date(u.timestamp) >= monthStart
    );

    return {
      totalTenants: this.data.tenants.length,
      activeTenants: active.length,
      planDistribution: planDist,
      totalUsageThisMonth: monthUsage.reduce((s, u) => s + u.amount, 0),
    };
  }

  // ==================== 内部 ====================

  private generateApiKey(): string {
    return `jvs_${crypto.randomBytes(24).toString("hex")}`;
  }

  private initQuotas(_tenantId: string, _plan: PlanTier): void {
    // 配额在查询时动态计算，无需初始化
  }

  private load(): void {
    try {
      if (fs.existsSync(this.config.dataPath)) {
        const raw = fs.readFileSync(this.config.dataPath, "utf-8");
        this.data = JSON.parse(raw);
        // 重建索引
        for (const t of this.data.tenants) {
          this.tenantMap.set(t.id, t);
          for (const k of t.apiKeys) {
            this.keyMap.set(k.key, t.id);
          }
        }
      }
    } catch {
      this.data = { tenants: [], usage: [], bills: [] };
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(this.config.dataPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.config.dataPath, JSON.stringify(this.data, null, 2));
    } catch {
      // ignore
    }
  }
}
