/**
 * Skills Marketplace 类型定义
 *
 * 实现类 npm/LobeChat Plugin Market 的 Skill 分发平台：
 * - Registry: 中心化注册表（JSON 文件 / HTTP API）
 * - Package: Skill 包格式
 * - Rating: 评分与下载统计
 */

import type { SkillMeta, SkillCategory } from "../skills/types.js";

// ==================== 注册表条目 ====================

/** Marketplace 中的 Skill 包 */
export interface MarketplacePackage {
  /** 唯一名称（如 @jarvis/skill-weather） */
  name: string;
  /** 显示名称 */
  displayName: string;
  /** 一句话描述 */
  description: string;
  /** 详细介绍（Markdown） */
  readme?: string;
  /** 当前版本号 */
  version: string;
  /** 作者 */
  author: PackageAuthor;
  /** 分类 */
  category: SkillCategory;
  /** 标签 */
  tags: string[];
  /** 关键词（用于搜索） */
  keywords?: string[];
  /** 图标 URL */
  icon?: string;
  /** 截图 */
  screenshots?: string[];
  /** 许可证 */
  license: string;
  /** 仓库地址 */
  repository?: string;
  /** 主页 */
  homepage?: string;
  /** 下载/安装来源 */
  source: PackageSource;
  /** 提供的工具列表 */
  tools: PackageToolInfo[];
  /** Skill 元数据（完整） */
  skillMeta: SkillMeta;
  /** 评分数据 */
  rating: PackageRating;
  /** 下载统计 */
  downloads: DownloadStats;
  /** 兼容性 */
  compatibility: {
    /** 最低 Agent Core 版本 */
    minVersion: string;
    /** 支持的平台 */
    platforms?: string[];
  };
  /** 状态 */
  status: "active" | "deprecated" | "unlisted";
  /** 发布时间 */
  publishedAt: Date;
  /** 最后更新时间 */
  updatedAt: Date;
}

/** 包作者 */
export interface PackageAuthor {
  name: string;
  email?: string;
  url?: string;
  avatar?: string;
  verified?: boolean;
}

/** 包来源 */
export interface PackageSource {
  /** 类型 */
  type: "npm" | "github" | "url" | "local";
  /** 地址 */
  url: string;
  /** npm 包名 */
  npmPackage?: string;
  /** GitHub 仓库 */
  githubRepo?: string;
}

/** 包中的工具信息 */
export interface PackageToolInfo {
  name: string;
  description: string;
  parameterCount: number;
}

// ==================== 评分 ====================

/** 评分数据 */
export interface PackageRating {
  /** 平均分（1-5） */
  average: number;
  /** 评分人数 */
  count: number;
  /** 各星级数量 */
  distribution: {
    1: number;
    2: number;
    3: number;
    4: number;
    5: number;
  };
}

/** 用户评价 */
export interface PackageReview {
  id: string;
  packageName: string;
  userId: string;
  userName: string;
  rating: number;
  comment: string;
  createdAt: Date;
}

// ==================== 下载统计 ====================

/** 下载统计 */
export interface DownloadStats {
  total: number;
  weekly: number;
  monthly: number;
}

// ==================== 搜索 ====================

/** 搜索选项 */
export interface MarketplaceSearchOptions {
  /** 搜索关键词 */
  query?: string;
  /** 分类过滤 */
  category?: SkillCategory;
  /** 标签过滤 */
  tags?: string[];
  /** 排序方式 */
  sortBy?: "name" | "downloads" | "rating" | "updated";
  /** 排序方向 */
  sortOrder?: "asc" | "desc";
  /** 分页 */
  page?: number;
  pageSize?: number;
}

/** 搜索结果 */
export interface MarketplaceSearchResult {
  packages: MarketplacePackage[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ==================== 安装 ====================

/** 安装结果 */
export interface InstallResult {
  success: boolean;
  packageName: string;
  version: string;
  installedPath?: string;
  error?: string;
  toolsRegistered?: string[];
}

// ==================== Registry 配置 ====================

/** 注册表配置 */
export interface RegistryConfig {
  /** 注册表类型 */
  type: "local" | "remote";
  /** 本地注册表路径 */
  localPath?: string;
  /** 远程注册表 URL */
  remoteUrl?: string;
  /** 缓存时间（毫秒） */
  cacheTtl?: number;
}
