/**
 * SaaS 模块 — 多租户管理
 *
 * - TenantManager: 用户/API Key/配额/计费
 */

export { TenantManager } from "./tenant-manager.js";
export type {
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
