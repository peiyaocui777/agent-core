/**
 * Skills Registry — 技能注册表
 *
 * 本地优先的 Skill 包管理：
 * - 注册/注销 Skill 包
 * - 搜索/发现
 * - 安装/卸载
 * - 评分/下载统计
 * - JSON 文件持久化
 */

import type { AgentCore } from "../agent.js";
import type { SkillFactory } from "../skills/types.js";
import type {
  MarketplacePackage,
  MarketplaceSearchOptions,
  MarketplaceSearchResult,
  InstallResult,
  RegistryConfig,
  PackageReview,
  PackageRating,
} from "./types.js";

// ==================== Registry ====================

export class SkillRegistry {
  private packages: Map<string, MarketplacePackage> = new Map();
  private reviews: Map<string, PackageReview[]> = new Map();
  private config: RegistryConfig;
  private agent?: AgentCore;
  private filePath: string;

  constructor(config?: Partial<RegistryConfig>) {
    this.config = {
      type: "local",
      cacheTtl: 3600000, // 1 小时
      ...config,
    };

    const homeDir = process.env.HOME || process.env.USERPROFILE || "/tmp";
    this.filePath = this.config.localPath || `${homeDir}/.jarvis/marketplace/registry.json`;
  }

  /** 绑定 Agent（用于安装 Skill 后自动注册） */
  bindAgent(agent: AgentCore): void {
    this.agent = agent;
  }

  // ==================== 持久化 ====================

  /** 加载注册表 */
  async load(): Promise<void> {
    try {
      const fs = await import("fs");
      const path = await import("path");

      // 确保目录存在
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        const data = JSON.parse(raw);

        // 恢复 packages
        if (data.packages) {
          for (const pkg of data.packages) {
            pkg.publishedAt = new Date(pkg.publishedAt);
            pkg.updatedAt = new Date(pkg.updatedAt);
            this.packages.set(pkg.name, pkg);
          }
        }

        // 恢复 reviews
        if (data.reviews) {
          for (const [name, revs] of Object.entries(data.reviews)) {
            this.reviews.set(
              name,
              (revs as PackageReview[]).map((r) => ({
                ...r,
                createdAt: new Date(r.createdAt),
              }))
            );
          }
        }

        console.log(`[Registry] 已加载: ${this.packages.size} 个包`);
      }
    } catch (error) {
      console.error("[Registry] 加载失败:", error);
    }
  }

  /** 保存注册表 */
  async save(): Promise<void> {
    try {
      const fs = await import("fs");
      const path = await import("path");

      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data = {
        version: "1.0.0",
        updatedAt: new Date().toISOString(),
        packages: Array.from(this.packages.values()),
        reviews: Object.fromEntries(this.reviews),
      };

      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (error) {
      console.error("[Registry] 保存失败:", error);
    }
  }

  // ==================== 包管理 ====================

  /** 发布/注册 Skill 包 */
  async publish(pkg: MarketplacePackage): Promise<void> {
    const existing = this.packages.get(pkg.name);

    if (existing) {
      // 更新
      pkg.publishedAt = existing.publishedAt;
      pkg.updatedAt = new Date();
      pkg.rating = existing.rating;
      pkg.downloads = existing.downloads;
    } else {
      pkg.publishedAt = new Date();
      pkg.updatedAt = new Date();
      pkg.rating = pkg.rating || { average: 0, count: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
      pkg.downloads = pkg.downloads || { total: 0, weekly: 0, monthly: 0 };
    }

    this.packages.set(pkg.name, pkg);
    await this.save();
    console.log(`[Registry] 已发布: ${pkg.name}@${pkg.version}`);
  }

  /** 注销包 */
  async unpublish(name: string): Promise<boolean> {
    if (!this.packages.has(name)) return false;
    this.packages.delete(name);
    this.reviews.delete(name);
    await this.save();
    console.log(`[Registry] 已注销: ${name}`);
    return true;
  }

  /** 获取包详情 */
  getPackage(name: string): MarketplacePackage | undefined {
    return this.packages.get(name);
  }

  /** 列出所有包 */
  listAll(): MarketplacePackage[] {
    return Array.from(this.packages.values()).filter((p) => p.status === "active");
  }

  // ==================== 搜索 ====================

  /** 搜索 Skill 包 */
  search(options: MarketplaceSearchOptions = {}): MarketplaceSearchResult {
    let results = Array.from(this.packages.values()).filter((p) => p.status === "active");

    // 关键词搜索
    if (options.query) {
      const q = options.query.toLowerCase();
      results = results.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.displayName.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.tags.some((t) => t.toLowerCase().includes(q)) ||
          p.keywords?.some((k) => k.toLowerCase().includes(q))
      );
    }

    // 分类过滤
    if (options.category) {
      results = results.filter((p) => p.category === options.category);
    }

    // 标签过滤
    if (options.tags?.length) {
      results = results.filter((p) =>
        options.tags!.some((tag) => p.tags.includes(tag))
      );
    }

    // 排序
    const sortBy = options.sortBy || "downloads";
    const sortOrder = options.sortOrder || "desc";
    const multiplier = sortOrder === "desc" ? -1 : 1;

    results.sort((a, b) => {
      switch (sortBy) {
        case "name":
          return a.name.localeCompare(b.name) * multiplier;
        case "downloads":
          return (a.downloads.total - b.downloads.total) * multiplier;
        case "rating":
          return (a.rating.average - b.rating.average) * multiplier;
        case "updated":
          return (a.updatedAt.getTime() - b.updatedAt.getTime()) * multiplier;
        default:
          return 0;
      }
    });

    // 分页
    const page = options.page || 1;
    const pageSize = options.pageSize || 20;
    const start = (page - 1) * pageSize;
    const paged = results.slice(start, start + pageSize);

    return {
      packages: paged,
      total: results.length,
      page,
      pageSize,
      hasMore: start + pageSize < results.length,
    };
  }

  // ==================== 安装/卸载 ====================

  /** 安装 Skill 到本地 */
  async install(packageName: string): Promise<InstallResult> {
    const pkg = this.packages.get(packageName);
    if (!pkg) {
      return { success: false, packageName, version: "", error: "包不存在" };
    }

    try {
      const fs = await import("fs");
      const path = await import("path");

      // 安装目标路径
      const homeDir = process.env.HOME || process.env.USERPROFILE || "/tmp";
      const installDir = path.join(homeDir, ".jarvis", "skills", pkg.name);

      // 创建目录
      if (!fs.existsSync(installDir)) {
        fs.mkdirSync(installDir, { recursive: true });
      }

      // 写入 skill.json
      fs.writeFileSync(
        path.join(installDir, "skill.json"),
        JSON.stringify(pkg.skillMeta, null, 2),
        "utf-8"
      );

      // 生成 index.ts 框架
      const toolDefs = pkg.tools
        .map(
          (t) =>
            `    {
      name: "${t.name}",
      description: "${t.description}",
      category: "workflow" as const,
      parameters: {},
      execute: async (params) => {
        // TODO: 实现 ${t.name}
        return { success: true, data: "已安装但未实现" };
      },
    }`
        )
        .join(",\n");

      const indexContent = `import { wrapToolsAsSkill } from "@jarvis/agent-core";
import type { AgentConfig } from "@jarvis/agent-core";

export default function createSkill(config: AgentConfig) {
  const tools = [
${toolDefs}
  ];

  return wrapToolsAsSkill(
    {
      name: "${pkg.skillMeta.name}",
      version: "${pkg.version}",
      description: "${pkg.description}",
      category: "${pkg.category}",
      tags: ${JSON.stringify(pkg.tags)},
    },
    tools
  );
}
`;

      fs.writeFileSync(path.join(installDir, "index.ts"), indexContent, "utf-8");

      // 更新下载计数
      pkg.downloads.total++;
      pkg.downloads.weekly++;
      pkg.downloads.monthly++;
      await this.save();

      // 如果绑定了 Agent，自动加载
      const toolsRegistered: string[] = [];
      if (this.agent) {
        try {
          const loaded = await this.agent.loadSkillsFromDir(
            path.dirname(installDir)
          );
          toolsRegistered.push(...loaded);
        } catch {
          // 加载失败不影响安装结果
        }
      }

      console.log(`[Registry] 已安装: ${pkg.name}@${pkg.version} → ${installDir}`);

      return {
        success: true,
        packageName: pkg.name,
        version: pkg.version,
        installedPath: installDir,
        toolsRegistered,
      };
    } catch (error) {
      return {
        success: false,
        packageName,
        version: pkg.version,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** 卸载已安装的 Skill */
  async uninstall(packageName: string): Promise<boolean> {
    try {
      const fs = await import("fs");
      const path = await import("path");

      const homeDir = process.env.HOME || process.env.USERPROFILE || "/tmp";
      const installDir = path.join(homeDir, ".jarvis", "skills", packageName);

      if (fs.existsSync(installDir)) {
        fs.rmSync(installDir, { recursive: true, force: true });
      }

      // 如果绑定了 Agent，卸载 Skill
      if (this.agent) {
        await this.agent.skills.unloadSkill(packageName);
      }

      console.log(`[Registry] 已卸载: ${packageName}`);
      return true;
    } catch (error) {
      console.error(`[Registry] 卸载失败: ${packageName}`, error);
      return false;
    }
  }

  // ==================== 评分系统 ====================

  /** 添加评价 */
  async addReview(review: PackageReview): Promise<void> {
    const pkg = this.packages.get(review.packageName);
    if (!pkg) return;

    if (!this.reviews.has(review.packageName)) {
      this.reviews.set(review.packageName, []);
    }

    const reviews = this.reviews.get(review.packageName)!;

    // 去重（同一用户只保留最新评价）
    const idx = reviews.findIndex((r) => r.userId === review.userId);
    if (idx >= 0) {
      reviews[idx] = review;
    } else {
      reviews.push(review);
    }

    // 重新计算评分
    this.recalculateRating(review.packageName);
    await this.save();
  }

  /** 获取评价列表 */
  getReviews(packageName: string): PackageReview[] {
    return this.reviews.get(packageName) || [];
  }

  /** 重新计算评分 */
  private recalculateRating(packageName: string): void {
    const pkg = this.packages.get(packageName);
    const reviews = this.reviews.get(packageName);
    if (!pkg || !reviews?.length) return;

    const dist: PackageRating["distribution"] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let sum = 0;

    for (const rev of reviews) {
      const score = Math.min(5, Math.max(1, Math.round(rev.rating))) as 1 | 2 | 3 | 4 | 5;
      dist[score]++;
      sum += rev.rating;
    }

    pkg.rating = {
      average: Math.round((sum / reviews.length) * 10) / 10,
      count: reviews.length,
      distribution: dist,
    };
  }

  // ==================== 统计 ====================

  /** 获取 Marketplace 统计 */
  getStats(): {
    totalPackages: number;
    totalDownloads: number;
    categories: Record<string, number>;
    topPackages: Array<{ name: string; downloads: number; rating: number }>;
  } {
    const packages = this.listAll();
    const categories: Record<string, number> = {};
    let totalDownloads = 0;

    for (const pkg of packages) {
      totalDownloads += pkg.downloads.total;
      categories[pkg.category] = (categories[pkg.category] || 0) + 1;
    }

    const topPackages = [...packages]
      .sort((a, b) => b.downloads.total - a.downloads.total)
      .slice(0, 10)
      .map((p) => ({
        name: p.name,
        downloads: p.downloads.total,
        rating: p.rating.average,
      }));

    return {
      totalPackages: packages.length,
      totalDownloads,
      categories,
      topPackages,
    };
  }
}
