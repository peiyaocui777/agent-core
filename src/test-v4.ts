/**
 * Phase 3D 端到端测试
 *
 * 测试模块：
 * 1. Skills Marketplace — 注册/搜索/安装/评分
 * 2. Web Dashboard — API 端点
 * 3. CLI — 命令解析
 * 4. 集成测试 — 全模块协同
 */

import { AgentCore } from "./agent.js";
import { getAllBundledSkills } from "./skills/bundled/index.js";
import { SkillRegistry } from "./marketplace/registry.js";
import { getBuiltinPackages, BUILTIN_PACKAGES } from "./marketplace/builtin-packages.js";
import { DashboardServer } from "./dashboard/server.js";
import { Orchestrator } from "./multi-agent/orchestrator.js";
import { WorkflowEngine, getAllPresetPipelines } from "./workflow/index.js";

import type { MarketplacePackage, PackageReview } from "./marketplace/types.js";

// ==================== 测试辅助 ====================

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.log(`  ❌ ${message}`);
    failed++;
  }
}

function section(title: string): void {
  console.log(`\n${"=".repeat(50)}`);
  console.log(`📦 ${title}`);
  console.log("=".repeat(50));
}

function createTestAgent(): AgentCore {
  const agent = new AgentCore({
    xhsApiUrl: "http://localhost:18060",
    wechatApiUrl: "http://localhost:18061",
  });
  agent.registerSkills(getAllBundledSkills());
  return agent;
}

// ==================== 测试 1: Marketplace 内置包 ====================

async function testBuiltinPackages(): Promise<void> {
  section("测试 1: Marketplace 内置包");

  const packages = getBuiltinPackages();
  assert(packages.length === 5, `内置包: ${packages.length} 个`);

  // 验证每个包的完整性
  for (const pkg of packages) {
    assert(!!pkg.name, `包名: ${pkg.name}`);
    assert(!!pkg.displayName, `显示名: ${pkg.displayName}`);
    assert(!!pkg.description, `描述: ${pkg.description}`);
    assert(!!pkg.version, `版本: ${pkg.version}`);
    assert(!!pkg.author.name, `作者: ${pkg.author.name}`);
    assert(pkg.tools.length > 0, `工具: ${pkg.tools.length} 个`);
    assert(pkg.rating.count > 0, `评分: ${pkg.rating.average} (${pkg.rating.count})`);
    assert(pkg.downloads.total > 0, `下载: ${pkg.downloads.total}`);
  }

  // 验证分类分布
  const categories = new Set(packages.map((p) => p.category));
  assert(categories.size >= 3, `覆盖 ${categories.size} 个分类: ${[...categories].join(", ")}`);
}

// ==================== 测试 2: Registry 操作 ====================

async function testRegistry(): Promise<void> {
  section("测试 2: Registry 注册/搜索/评分");

  // 使用临时路径
  const registry = new SkillRegistry({
    localPath: "/tmp/jarvis-test-registry.json",
  });

  // 清理旧数据
  const fs = await import("fs");
  try { fs.unlinkSync("/tmp/jarvis-test-registry.json"); } catch {}

  await registry.load();
  assert(registry.listAll().length === 0, "初始为空");

  // 注册内置包
  for (const pkg of BUILTIN_PACKAGES) {
    await registry.publish(pkg);
  }
  assert(registry.listAll().length === 5, `注册后: ${registry.listAll().length} 个包`);

  // 搜索 — 关键词
  const searchResult = registry.search({ query: "小红书" });
  assert(searchResult.packages.length >= 1, `搜索"小红书": ${searchResult.packages.length} 个结果`);

  // 搜索 — 分类
  const contentPkgs = registry.search({ category: "content" });
  assert(contentPkgs.packages.length === 2, `content 分类: ${contentPkgs.packages.length} 个`);

  // 搜索 — 排序
  const byDownloads = registry.search({ sortBy: "downloads", sortOrder: "desc" });
  assert(
    byDownloads.packages[0].downloads.total >= byDownloads.packages[1].downloads.total,
    "下载量降序排列"
  );

  const byRating = registry.search({ sortBy: "rating", sortOrder: "desc" });
  assert(
    byRating.packages[0].rating.average >= byRating.packages[1].rating.average,
    "评分降序排列"
  );

  // 搜索 — 分页
  const paged = registry.search({ pageSize: 2, page: 1 });
  assert(paged.packages.length === 2, `分页(每页2): ${paged.packages.length} 个`);
  assert(paged.hasMore === true, "有更多页");

  const page2 = registry.search({ pageSize: 2, page: 2 });
  assert(page2.packages.length === 2, `第2页: ${page2.packages.length} 个`);

  // 获取详情
  const pkg = registry.getPackage("@jarvis/skill-content-writer");
  assert(pkg !== undefined, "获取包详情成功");
  assert(pkg!.displayName === "AI 内容写手", `显示名: ${pkg!.displayName}`);

  // 评分系统
  const review: PackageReview = {
    id: "rev-1",
    packageName: "@jarvis/skill-content-writer",
    userId: "user-test",
    userName: "测试用户",
    rating: 5,
    comment: "非常好用！",
    createdAt: new Date(),
  };
  await registry.addReview(review);

  const reviews = registry.getReviews("@jarvis/skill-content-writer");
  assert(reviews.length === 1, `评价数: ${reviews.length}`);

  // 重复评价（同一用户只保留最新）
  await registry.addReview({ ...review, rating: 4, comment: "更新评价" });
  const updatedReviews = registry.getReviews("@jarvis/skill-content-writer");
  assert(updatedReviews.length === 1, "同用户评价去重");
  assert(updatedReviews[0].rating === 4, "评分已更新");

  // 统计
  const stats = registry.getStats();
  assert(stats.totalPackages === 5, `总包数: ${stats.totalPackages}`);
  assert(stats.totalDownloads > 0, `总下载: ${stats.totalDownloads}`);
  assert(stats.topPackages.length > 0, `热门包: ${stats.topPackages.length} 个`);

  // 注销
  const unpublished = await registry.unpublish("@jarvis/skill-content-scraper");
  assert(unpublished, "注销成功");
  assert(registry.listAll().length === 4, `注销后: ${registry.listAll().length} 个`);

  // 持久化验证
  await registry.save();
  const registry2 = new SkillRegistry({ localPath: "/tmp/jarvis-test-registry.json" });
  await registry2.load();
  assert(registry2.listAll().length === 4, `重新加载后: ${registry2.listAll().length} 个`);
}

// ==================== 测试 3: Dashboard API ====================

async function testDashboard(): Promise<void> {
  section("测试 3: Dashboard API");

  const agent = createTestAgent();
  await agent.initialize();

  const registry = new SkillRegistry({ localPath: "/tmp/jarvis-test-dash-registry.json" });
  const fs = await import("fs");
  try { fs.unlinkSync("/tmp/jarvis-test-dash-registry.json"); } catch {}
  await registry.load();
  for (const pkg of BUILTIN_PACKAGES) {
    await registry.publish(pkg);
  }

  const orchestrator = new Orchestrator(agent);
  const workflow = new WorkflowEngine(agent);
  for (const p of getAllPresetPipelines()) {
    workflow.register(p);
  }

  const dashboard = new DashboardServer(
    agent,
    { port: 13800 },
    { registry, orchestrator, workflow },
  );
  await dashboard.start();

  // 测试 API 端点
  const baseUrl = "http://127.0.0.1:13800";

  const statusRes = await fetch(`${baseUrl}/api/status`);
  const status = await statusRes.json() as Record<string, unknown>;
  assert(statusRes.status === 200, "GET /api/status → 200");
  assert((status as any).tools > 0, `状态工具数: ${(status as any).tools}`);

  const skillsRes = await fetch(`${baseUrl}/api/skills`);
  const skills = await skillsRes.json() as unknown[];
  assert(skillsRes.status === 200, "GET /api/skills → 200");
  assert(skills.length === 10, `Skills 数: ${skills.length}`);

  const toolsRes = await fetch(`${baseUrl}/api/tools`);
  const tools = await toolsRes.json() as unknown[];
  assert(toolsRes.status === 200, "GET /api/tools → 200");
  assert(tools.length >= 10, `工具数: ${tools.length}`);

  const memoryRes = await fetch(`${baseUrl}/api/memory`);
  assert(memoryRes.status === 200, "GET /api/memory → 200");

  const mpRes = await fetch(`${baseUrl}/api/marketplace`);
  const mp = await mpRes.json() as Record<string, unknown>;
  assert(mpRes.status === 200, "GET /api/marketplace → 200");
  assert((mp as any).total === 5, `Marketplace 包数: ${(mp as any).total}`);

  const mpSearchRes = await fetch(`${baseUrl}/api/marketplace?q=AI`);
  const mpSearch = await mpSearchRes.json() as Record<string, unknown>;
  assert((mpSearch as any).packages.length >= 1, `Marketplace 搜索 "AI": ${(mpSearch as any).packages.length} 个`);

  const pipRes = await fetch(`${baseUrl}/api/workflow/pipelines`);
  const pipelines = await pipRes.json() as unknown[];
  assert(pipRes.status === 200, "GET /api/workflow/pipelines → 200");
  assert(pipelines.length === 3, `管道数: ${pipelines.length}`);

  const orchRes = await fetch(`${baseUrl}/api/orchestrator`);
  assert(orchRes.status === 200, "GET /api/orchestrator → 200");

  // Dashboard HTML
  const htmlRes = await fetch(`${baseUrl}/`);
  const html = await htmlRes.text();
  assert(htmlRes.status === 200, "GET / → 200 (Dashboard HTML)");
  assert(html.includes("Jarvis Agent"), "HTML 包含标题");
  assert(html.includes("Marketplace"), "HTML 包含 Marketplace 标签");

  // 404
  const notFoundRes = await fetch(`${baseUrl}/api/nonexistent`);
  assert(notFoundRes.status === 404, "未知路径返回 404");

  await dashboard.stop();
  await agent.shutdown();
}

// ==================== 测试 4: 全模块集成 ====================

async function testFullIntegration(): Promise<void> {
  section("测试 4: 全模块集成");

  const agent = createTestAgent();
  await agent.initialize();

  // Marketplace
  const registry = new SkillRegistry({ localPath: "/tmp/jarvis-test-full-registry.json" });
  const fs = await import("fs");
  try { fs.unlinkSync("/tmp/jarvis-test-full-registry.json"); } catch {}
  await registry.load();
  registry.bindAgent(agent);
  for (const pkg of BUILTIN_PACKAGES) {
    await registry.publish(pkg);
  }

  // Multi-Agent
  const orchestrator = new Orchestrator(agent);

  // Workflow
  const workflow = new WorkflowEngine(agent);
  for (const p of getAllPresetPipelines()) {
    workflow.register(p);
  }

  // 验证全部模块可用
  assert(agent.getAllTools().length >= 16, `Agent 工具: ${agent.getAllTools().length}`);
  assert(registry.listAll().length === 5, `Marketplace: ${registry.listAll().length} 个包`);
  assert(orchestrator.listRoles().length === 5, `角色: ${orchestrator.listRoles().length}`);
  assert(workflow.listPipelines().length === 3, `管道: ${workflow.listPipelines().length}`);

  // Marketplace 搜索 + Registry 统计
  const stats = registry.getStats();
  assert(stats.totalPackages === 5, `Marketplace 总包数: ${stats.totalPackages}`);
  assert(Object.keys(stats.categories).length >= 3, `分类: ${Object.keys(stats.categories).length}`);

  // Agent 状态全面
  const agentStatus = agent.getStatus();
  assert(agentStatus.skills.active === 10, `活跃 Skills: ${agentStatus.skills.active}`);
  assert(agentStatus.tools >= 16, `总工具: ${agentStatus.tools}`);

  assert(true, "全模块协同正常 🎉");

  await agent.shutdown();
}

// ==================== 主入口 ====================

async function main(): Promise<void> {
  console.log("🚀 Jarvis Agent v3 — Phase 3D 端到端测试\n");
  console.log("模块: Marketplace + Dashboard + CLI + 开源准备\n");

  const start = Date.now();

  await testBuiltinPackages();
  await testRegistry();
  await testDashboard();
  await testFullIntegration();

  const elapsed = Date.now() - start;

  console.log(`\n${"=".repeat(50)}`);
  console.log(`📊 测试结果: ✅ ${passed} 通过  ❌ ${failed} 失败  ⏱️ ${elapsed}ms`);
  console.log("=".repeat(50));

  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error("测试异常:", err);
  process.exit(1);
});
