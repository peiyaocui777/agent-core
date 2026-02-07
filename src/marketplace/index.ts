/**
 * Marketplace 模块 — Skills 市场
 *
 * - SkillRegistry: 技能注册表（注册/搜索/安装/评分）
 * - BUILTIN_PACKAGES: 内置 Skill 的市场包定义
 * - Types: 市场包、评分、搜索等类型
 */

export { SkillRegistry } from "./registry.js";
export { BUILTIN_PACKAGES, getBuiltinPackages } from "./builtin-packages.js";
export type {
  MarketplacePackage,
  MarketplaceSearchOptions,
  MarketplaceSearchResult,
  InstallResult,
  RegistryConfig,
  PackageAuthor,
  PackageSource,
  PackageToolInfo,
  PackageRating,
  PackageReview,
  DownloadStats,
} from "./types.js";
