/**
 * Phase 4 端到端测试 — 风控 + 多平台 + 数据分析 + 质量引擎
 *
 * 运行: npx tsx src/test-v5.ts
 */

import { SafetyEngine } from "./safety/index.js";
import { AnalyticsEngine } from "./analytics/index.js";
import { QualityEngine } from "./quality/index.js";
import { getAllBundledSkills } from "./skills/bundled/index.js";
import * as fs from "fs";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.log(`  ❌ ${label}`);
  }
}

// ==================== 1. SafetyEngine 测试 ====================

async function testSafetyEngine() {
  console.log("\n🛡️  [1] SafetyEngine — 风控引擎");

  // 1.1 初始化
  const safety = new SafetyEngine({ level: "moderate" });
  assert(safety !== null, "SafetyEngine 初始化成功");

  const status = safety.getStatus();
  assert(status.level === "moderate", "安全级别 = moderate");
  assert(status.sensitiveWordCount > 20, `敏感词库 ${status.sensitiveWordCount} 个`);
  assert(status.platformRuleCount >= 6, `平台规则 ${status.platformRuleCount} 条`);
  assert(status.rateLimitCount >= 5, `频率规则 ${status.rateLimitCount} 条`);

  // 1.2 内容安全 — 正常内容
  const clean = safety.checkContent("今天天气不错，适合去公园散步。");
  assert(clean.passed === true, "正常内容通过检查");
  assert(clean.riskScore === 0, "风险分 = 0");
  assert(clean.action === "allow", "动作 = allow");

  // 1.3 内容安全 — 违规内容
  const bad = safety.checkContent("加微信领取免费福利，日赚万元，点击链接立刻变现");
  assert(bad.passed === false, "违规内容被拦截");
  assert(bad.riskScore > 0, `风险分 = ${bad.riskScore}`);
  assert(bad.violations.length > 0, `检测到 ${bad.violations.length} 个违规`);

  // 1.4 内容安全 — 个人信息
  const pii = safety.checkContent("我的手机号是 13800138000");
  assert(pii.violations.some((v) => v.type === "personal_info"), "检测到手机号");

  // 1.5 内容清理
  const { cleaned, replacements } = safety.sanitizeContent("加微信领取免费福利");
  assert(replacements > 0, `替换了 ${replacements} 处违规词`);
  assert(!cleaned.includes("加微信"), "清理后不含违规词");

  // 1.6 频率控制
  const rate1 = safety.checkRateLimit("xiaohongshu", "publish");
  assert(rate1.allowed === true, "首次发布频率允许");

  // 多次记录
  for (let i = 0; i < 5; i++) {
    safety.recordAction("xiaohongshu", "publish");
  }
  const rate2 = safety.checkRateLimit("xiaohongshu", "publish");
  assert(rate2.allowed === false, "超频后被限制");
  assert((rate2.retryAfterMs || 0) > 0, `需等待 ${Math.ceil((rate2.retryAfterMs || 0) / 1000)}s`);

  // 1.7 平台合规
  const platformOk = safety.checkPlatformRules("xiaohongshu", {
    title: "这是一篇不错的测试文章",
    content: "内容很好",
  });
  assert(platformOk.passed === true, "符合小红书规则");

  const platformBad = safety.checkPlatformRules("xiaohongshu", {
    title: "这是一篇标题非常非常非常非常长的小红书笔记需要超过限制",
    content: "内容",
    tags: Array(15).fill("tag"),
  });
  assert(platformBad.passed === false, "标题/标签超限被检测");
  assert(platformBad.issues.length >= 1, `发现 ${platformBad.issues.length} 个合规问题`);

  // 1.8 抖音平台规则
  const douyinRule = safety.getPlatformRule("douyin");
  assert(douyinRule !== undefined, "包含抖音平台规则");
  assert(douyinRule!.titleMaxLength === 55, "抖音标题限制 55 字");

  // 1.9 反封策略
  const delay = safety.getRandomDelay();
  assert(delay >= 2000 && delay <= 8000, `随机延迟 ${delay}ms`);

  const daily = safety.checkDailyLimit();
  assert(daily.allowed === true, "未超每日上限");

  const active = safety.isActiveHour();
  assert(typeof active === "boolean", `活跃时段检查: ${active}`);

  // 1.10 失败冷却
  safety.recordFailure("test-platform");
  safety.recordFailure("test-platform");
  const cooldown = safety.recordFailure("test-platform");
  assert(cooldown.needsCooldown === true, "3 次失败触发冷却");
  assert(cooldown.cooldownMs === 300000, "冷却 5 分钟");

  safety.resetFailure("test-platform");
  const after = safety.recordFailure("test-platform");
  assert(after.needsCooldown === false, "重置后不触发冷却");

  // 1.11 综合预发布检查
  const pre = await safety.prePublishCheck("bilibili", {
    title: "AI 入门指南",
    content: "一篇关于人工智能入门的文章，内容积极向上。",
  });
  assert(typeof pre.allowed === "boolean", "预发布检查返回结果");
  assert(pre.contentCheck !== undefined, "包含内容安全检查");
  assert(pre.platformCheck !== undefined, "包含平台合规检查");

  // 1.12 自定义敏感词
  safety.addSensitiveWord("测试违规词");
  const custom = safety.checkContent("这里有个测试违规词");
  assert(custom.violations.some((v) => v.type === "sensitive_word"), "自定义敏感词生效");

  // 1.13 白名单
  safety.addWhitelistWord("测试违规词");
  const whitelisted = safety.checkContent("这里有个测试违规词");
  assert(!whitelisted.violations.some((v) => v.snippet?.includes("测试违规词")), "白名单生效");
}

// ==================== 2. 多平台 Skill 测试 ====================

function testMultiPlatformSkills() {
  console.log("\n🌐 [2] 多平台 Skill — 抖音/B站/微博/知乎");

  const allSkills = getAllBundledSkills();
  assert(allSkills.length === 10, `内置 Skill 总数 = ${allSkills.length} (10个)`);

  // 2.1 查找新平台 Skill
  const skillNames = allSkills.map((factory) => {
    const skill = factory({});
    return skill.meta.name;
  });

  assert(skillNames.includes("douyin-publisher"), "包含 douyin-publisher");
  assert(skillNames.includes("bilibili-publisher"), "包含 bilibili-publisher");
  assert(skillNames.includes("weibo-publisher"), "包含 weibo-publisher");
  assert(skillNames.includes("zhihu-publisher"), "包含 zhihu-publisher");

  // 2.2 验证各 Skill 工具数（meta.tools 列出工具名）
  for (const factory of allSkills) {
    const skill = factory({});
    const toolCount = skill.meta.tools.length;
    assert(toolCount > 0, `${skill.meta.name}: ${toolCount} 个工具（meta）`);
  }

  // 2.3 验证触发词
  const douyinSkill = allSkills.find((f) => f({}).meta.name === "douyin-publisher")!({});
  assert(douyinSkill.meta.triggers!.includes("抖音"), "抖音触发词配置正确");

  const biliSkill = allSkills.find((f) => f({}).meta.name === "bilibili-publisher")!({});
  assert(biliSkill.meta.triggers!.includes("B站"), "B站触发词配置正确");

  const weiboSkill = allSkills.find((f) => f({}).meta.name === "weibo-publisher")!({});
  assert(weiboSkill.meta.triggers!.includes("微博"), "微博触发词配置正确");

  const zhihuSkill = allSkills.find((f) => f({}).meta.name === "zhihu-publisher")!({});
  assert(zhihuSkill.meta.triggers!.includes("知乎"), "知乎触发词配置正确");

  // 2.4 验证工具名（通过 meta.tools 校验）
  const allToolNames = allSkills.flatMap((f) => f({}).meta.tools);

  assert(allToolNames.includes("douyin-publish-video"), "包含 douyin-publish-video");
  assert(allToolNames.includes("douyin-publish-image"), "包含 douyin-publish-image");
  assert(allToolNames.includes("douyin-trending"), "包含 douyin-trending");
  assert(allToolNames.includes("bilibili-publish-article"), "包含 bilibili-publish-article");
  assert(allToolNames.includes("bilibili-publish-dynamic"), "包含 bilibili-publish-dynamic");
  assert(allToolNames.includes("bilibili-trending"), "包含 bilibili-trending");
  assert(allToolNames.includes("weibo-publish"), "包含 weibo-publish");
  assert(allToolNames.includes("weibo-hot-search"), "包含 weibo-hot-search");
  assert(allToolNames.includes("weibo-repost"), "包含 weibo-repost");
  assert(allToolNames.includes("zhihu-publish-article"), "包含 zhihu-publish-article");
  assert(allToolNames.includes("zhihu-answer-question"), "包含 zhihu-answer-question");
  assert(allToolNames.includes("zhihu-hot-list"), "包含 zhihu-hot-list");
  assert(allToolNames.includes("zhihu-search-questions"), "包含 zhihu-search-questions");

  // 2.5 总工具数（meta 声明的）
  console.log(`  📊 总工具数: ${allToolNames.length} 个 (跨 9 个 Skill)`);
  assert(allToolNames.length >= 25, `总工具数 >= 25 (实际 ${allToolNames.length})`);
}

// ==================== 3. AnalyticsEngine 测试 ====================

function testAnalyticsEngine() {
  console.log("\n📊 [3] AnalyticsEngine — 数据分析引擎");

  // 清理测试数据
  const testPath = "/tmp/jarvis-test-analytics.json";
  try { fs.unlinkSync(testPath); } catch {}

  const analytics = new AnalyticsEngine({ dataPath: testPath });
  assert(analytics !== null, "AnalyticsEngine 初始化成功");

  // 3.1 记录数据
  analytics.trackContent(
    {
      contentId: "xhs-001",
      platform: "xiaohongshu",
      title: "AI 副业指南",
      publishedAt: new Date().toISOString(),
      views: 5000,
      likes: 300,
      comments: 50,
      favorites: 200,
      shares: 80,
      followerGain: 30,
      engagementRate: 0.126,
      updatedAt: new Date().toISOString(),
    },
    ["AI", "副业", "赚钱"]
  );

  analytics.trackContent({
    contentId: "dy-001",
    platform: "douyin",
    title: "健身打卡 Day 1",
    publishedAt: new Date().toISOString(),
    views: 10000,
    likes: 800,
    comments: 100,
    favorites: 50,
    shares: 200,
    followerGain: 50,
    engagementRate: 0.11,
    updatedAt: new Date().toISOString(),
  }, ["健身", "打卡"]);

  analytics.trackContent({
    contentId: "bili-001",
    platform: "bilibili",
    title: "深度解析 GPT-5",
    publishedAt: new Date().toISOString(),
    views: 8000,
    likes: 600,
    comments: 200,
    favorites: 400,
    shares: 100,
    followerGain: 80,
    engagementRate: 0.1125,
    updatedAt: new Date().toISOString(),
  }, ["AI", "GPT", "深度解析"]);

  const status = analytics.getStatus();
  assert(status.totalRecords === 3, `记录数 = ${status.totalRecords}`);
  assert(Object.keys(status.platforms).length === 3, "覆盖 3 个平台");

  // 3.2 查询
  const xhsContent = analytics.getContentByPlatform("xiaohongshu");
  assert(xhsContent.length === 1, "小红书 1 条记录");

  const topContent = analytics.getTopContent(5);
  assert(topContent.length === 3, "Top 内容 3 条");
  assert(topContent[0].engagementRate >= topContent[1].engagementRate, "按互动率排序");

  // 3.3 聚合报告
  const report = analytics.generateReport("30d");
  assert(report.timeRange === "30d", "报告时间范围 = 30d");
  assert(report.global.totalContent === 3, "全局总内容 3");
  assert(report.global.totalViews === 23000, `全局总浏览 = ${report.global.totalViews}`);
  assert(report.platforms.length >= 3, `平台概览 ${report.platforms.length} 个`);
  assert(report.dailyData.length >= 1, `日报数据 ${report.dailyData.length} 天`);

  // 3.4 标签表现
  assert(report.tagPerformance.length > 0, `标签表现 ${report.tagPerformance.length} 个`);
  const aiTag = report.tagPerformance.find((t) => t.tag === "AI");
  assert(aiTag !== undefined, "AI 标签有数据");
  assert(aiTag!.usageCount === 2, "AI 标签使用 2 次");

  // 3.5 批量更新
  const updated = analytics.batchUpdate([
    { contentId: "xhs-001", platform: "xiaohongshu", delta: { views: 6000, likes: 400 } },
  ]);
  assert(updated === 1, "批量更新 1 条");
  const updatedContent = analytics.getContentByPlatform("xiaohongshu")[0];
  assert(updatedContent.views === 6000, "浏览量已更新");

  // 3.6 SEO 评分
  const seoResult = analytics.scoreSEO(
    "这是一篇关于 AI 副业的干货文章。\n\n我亲测了多种方法，总结了以下 5 个技巧。\n\n#AI #副业 #赚钱\n\n觉得有帮助就点赞收藏吧！",
    "5 个 AI 副业技巧，新手必看",
    { targetKeywords: ["AI", "副业", "技巧"] }
  );
  assert(seoResult.totalScore > 0, `SEO 总分 = ${seoResult.totalScore}`);
  assert(["A", "B", "C", "D", "F"].includes(seoResult.grade), `SEO 等级 = ${seoResult.grade}`);
  assert(seoResult.checks.length > 0, `SEO 检查项 ${seoResult.checks.length} 个`);
  assert(Object.keys(seoResult.keywordDensity).length === 3, "关键词密度 3 个");

  // 3.7 数据导出
  const exported = analytics.exportData();
  assert(exported.metrics.length === 3, "导出 3 条记录");
  assert(Object.keys(exported.tags).length >= 2, "导出标签数据");
}

// ==================== 4. QualityEngine 测试 ====================

function testQualityEngine() {
  console.log("\n✨ [4] QualityEngine — 内容质量引擎");

  const quality = new QualityEngine();
  assert(quality !== null, "QualityEngine 初始化成功");

  // 4.1 高质量内容评分
  const goodContent = `✨ 5 个让你效率翻倍的 AI 工具推荐

作为一个深度使用 AI 工具的创作者，我亲测了上百款工具，今天给大家分享最实用的 5 个。

1. ChatGPT — 万能助手
最经典的 AI 对话工具，我每天都在用。无论是写文案、翻译、还是头脑风暴，它都能胜任。

2. Midjourney — 图片生成
想要精美配图？Midjourney 能根据你的文字描述生成超高质量的图片。

3. Notion AI — 笔记神器
在 Notion 中直接调用 AI，帮你整理笔记、生成摘要、提炼要点。

4. Cursor — 编程利器
AI 辅助编程工具，写代码效率提升 10 倍，强烈推荐给程序员。

5. 剪映 — 视频剪辑
配合 AI 字幕、AI 特效，让视频创作变得更简单。

💬 你还用过哪些好用的 AI 工具？欢迎在评论区留言分享！

#AI工具 #效率提升 #干货分享`;

  const goodScore = quality.scoreContent(goodContent, "5 个让你效率翻倍的 AI 工具推荐");
  assert(goodScore.totalScore >= 60, `高质量内容得分 = ${goodScore.totalScore}`);
  assert(goodScore.grade !== "D", `等级 = ${goodScore.grade}`);
  assert(goodScore.dimensions.length === 7, "7 个维度评分");
  console.log(`  📊 高质量内容: ${goodScore.totalScore}分 (${goodScore.grade} 级)`);

  // 4.2 低质量内容评分
  const badContent = "好用";
  const badScore = quality.scoreContent(badContent, "推荐");
  assert(badScore.totalScore < 80, `低质量内容得分 = ${badScore.totalScore}`);
  assert(badScore.recommendations.length > 0, `优化建议 ${badScore.recommendations.length} 条`);
  console.log(`  📊 低质量内容: ${badScore.totalScore}分 (${badScore.grade} 级)`);

  // 4.3 原创检测 — 高原创
  const originalResult = quality.checkOriginality(goodContent);
  assert(originalResult.originalityScore >= 50, `原创度 = ${originalResult.originalityScore}%`);
  console.log(`  📊 原创度: ${originalResult.originalityScore}% (AI概率: ${(originalResult.aiGeneratedProbability * 100).toFixed(0)}%)`);

  // 4.4 原创检测 — AI 套话
  const aiContent = `在当今社会，随着科技的发展，人工智能已经成为了不可忽视的力量。众所周知，AI 技术正在改变我们的生活方式。

首先，AI 在医疗领域的应用非常广泛。其次，AI 在教育领域也有着重要的作用。最后，AI 在金融领域的应用也越来越多。

综上所述，AI 的发展前景是非常广阔的。值得注意的是，我们需要合理使用 AI 技术。`;

  const aiResult = quality.checkOriginality(aiContent);
  assert(aiResult.suspiciousFragments.length > 0, `检测到 ${aiResult.suspiciousFragments.length} 处 AI 痕迹`);
  assert(aiResult.aiGeneratedProbability > 0.3, `AI 生成概率 = ${(aiResult.aiGeneratedProbability * 100).toFixed(0)}%`);
  console.log(`  📊 AI 套话检测: 原创度 ${aiResult.originalityScore}% (AI概率: ${(aiResult.aiGeneratedProbability * 100).toFixed(0)}%)`);

  // 4.5 自动优化
  const simpleContent = "分享几个好用的工具给大家，希望对你们有帮助。";
  const optimized = quality.optimizeContent(
    simpleContent,
    "工具分享",
    { targetKeywords: ["AI工具", "效率"], addEmoji: true, addHashtags: true }
  );

  assert(optimized.changes.length > 0, `优化了 ${optimized.changes.length} 处`);
  assert(optimized.afterScore >= optimized.beforeScore, `优化后得分提升: ${optimized.beforeScore} → ${optimized.afterScore}`);
  console.log(`  📊 自动优化: ${optimized.beforeScore}分 → ${optimized.afterScore}分 (${optimized.changes.length} 处改动)`);

  // 4.6 综合发布检查
  const publishCheck = quality.prePublishQualityCheck(goodContent, "5 个让你效率翻倍的 AI 工具推荐");
  assert(typeof publishCheck.ready === "boolean", `发布就绪: ${publishCheck.ready}`);
  assert(publishCheck.qualityScore.totalScore > 0, "包含质量评分");
  assert(publishCheck.originality.originalityScore >= 0, "包含原创检测");

  // 4.7 各维度检查
  for (const dim of goodScore.dimensions) {
    assert(dim.score >= 0 && dim.score <= 100, `${dim.label}: ${dim.score}分`);
  }

  // 4.8 配置
  const config = quality.getConfig();
  assert(config.originalityThreshold === 70, "原创度阈值 = 70");
  assert(config.minPublishScore === 60, "最低发布分 = 60");
}

// ==================== 5. 集成测试 ====================

async function testIntegration() {
  console.log("\n🔗 [5] 集成测试 — Safety × Quality × Analytics");

  const safety = new SafetyEngine({ level: "moderate" });
  const quality = new QualityEngine();
  const testPath = "/tmp/jarvis-test-integration-analytics.json";
  try { fs.unlinkSync(testPath); } catch {}
  const analytics = new AnalyticsEngine({ dataPath: testPath });

  // 模拟完整发布流程
  const title = "5 个超实用的 AI 副业方法";
  const content = `最近研究了很多 AI 相关的副业机会，今天把我亲测有效的 5 个方法分享给大家。

1. AI 写作变现 — 用 ChatGPT 帮你写文案，效率提升 10 倍
2. AI 绘画接单 — Midjourney 生成作品，在平台上售卖
3. AI 课程制作 — 录制 AI 教程视频，上架知识付费平台
4. AI 自媒体 — 用 AI 辅助内容创作，多平台分发
5. AI 工具开发 — 做垂直领域的 AI 小工具

每个方法我都试过，最推荐第 4 个，收益稳定。

💡 想了解更多细节？关注我，后续会逐一详细分享。

#AI副业 #赚钱 #副业推荐 #AI工具`;

  // Step 1: 质量检查
  const qualityResult = quality.prePublishQualityCheck(content, title);
  assert(qualityResult.qualityScore.totalScore > 0, `Step 1 质量评分: ${qualityResult.qualityScore.totalScore}`);

  // Step 2: 风控检查
  const safetyResult = await safety.prePublishCheck("xiaohongshu", { title, content });
  assert(safetyResult.contentCheck !== undefined, "Step 2 风控检查完成");

  // Step 3: SEO 评分
  const seoResult = analytics.scoreSEO(content, title, {
    targetKeywords: ["AI", "副业", "赚钱"],
    platform: "xiaohongshu",
  });
  assert(seoResult.totalScore > 0, `Step 3 SEO 评分: ${seoResult.totalScore}`);

  // Step 4: 记录发布数据
  analytics.trackContent({
    contentId: "integration-001",
    platform: "xiaohongshu",
    title,
    publishedAt: new Date().toISOString(),
    views: 0,
    likes: 0,
    comments: 0,
    favorites: 0,
    shares: 0,
    followerGain: 0,
    engagementRate: 0,
    updatedAt: new Date().toISOString(),
  }, ["AI", "副业", "赚钱"]);

  const status = analytics.getStatus();
  assert(status.totalRecords === 1, "Step 4 数据记录成功");

  // Step 5: 模拟数据回填
  analytics.batchUpdate([
    {
      contentId: "integration-001",
      platform: "xiaohongshu",
      delta: { views: 3000, likes: 200, comments: 30, favorites: 100, shares: 50 },
    },
  ]);

  const report = analytics.generateReport("7d");
  assert(report.global.totalViews === 3000, "Step 5 数据回填生效");

  console.log(`\n  🎯 完整发布流程模拟:`);
  console.log(`     质量: ${qualityResult.qualityScore.totalScore}分 (${qualityResult.qualityScore.grade})`);
  console.log(`     风控: ${safetyResult.contentCheck.passed ? "✅ 通过" : "⚠️ 需审核"}`);
  console.log(`     SEO:  ${seoResult.totalScore}分 (${seoResult.grade})`);
  console.log(`     分析: 3000 views, 200 likes, 30 comments`);
}

// ==================== 运行 ====================

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Phase 4 端到端测试 — 风控 + 多平台 + 分析 + 质量引擎");
  console.log("═══════════════════════════════════════════════════════════");

  await testSafetyEngine();
  testMultiPlatformSkills();
  testAnalyticsEngine();
  testQualityEngine();
  await testIntegration();

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log(`  结果: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log("═══════════════════════════════════════════════════════════\n");

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(console.error);
