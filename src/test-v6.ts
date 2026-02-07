/**
 * Phase 5 端到端测试 — BrowserPilot + CronMaestro + EventBus + PluginSDK + SaaS
 *
 * 运行: npx tsx src/test-v6.ts
 */

import { CronMaestro } from "./scheduler/cron-maestro.js";
import { EventBus, resetEventBus } from "./events/bus.js";
import { PluginSDK } from "./sdk/plugin-sdk.js";
import { TenantManager } from "./saas/tenant-manager.js";
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

// ==================== 1. BrowserPilot Skill ====================

function testBrowserPilot() {
  console.log("\n🌐 [1] BrowserPilot — 浏览器自动化 Skill");

  const allSkills = getAllBundledSkills();
  assert(allSkills.length === 10, `内置 Skill 总数 = ${allSkills.length} (10个)`);

  const browserSkill = allSkills.find((f) => f({}).meta.name === "browser-pilot");
  assert(browserSkill !== undefined, "包含 browser-pilot Skill");

  const skill = browserSkill!({});
  assert(skill.meta.tools.length === 10, `工具数 = ${skill.meta.tools.length} (10个)`);

  const toolNames = skill.meta.tools;
  assert(toolNames.includes("browser-navigate"), "包含 browser-navigate");
  assert(toolNames.includes("browser-screenshot"), "包含 browser-screenshot");
  assert(toolNames.includes("browser-extract"), "包含 browser-extract");
  assert(toolNames.includes("browser-fill-form"), "包含 browser-fill-form");
  assert(toolNames.includes("browser-click"), "包含 browser-click");
  assert(toolNames.includes("browser-cookies"), "包含 browser-cookies");
  assert(toolNames.includes("browser-wait"), "包含 browser-wait");
  assert(toolNames.includes("browser-evaluate"), "包含 browser-evaluate");
  assert(toolNames.includes("browser-close"), "包含 browser-close");
  assert(toolNames.includes("browser-pdf"), "包含 browser-pdf");

  assert(skill.meta.triggers!.includes("浏览器"), "触发词包含「浏览器」");
  assert(skill.meta.category === "workflow", "分类 = workflow");

  // 总工具数
  const allToolNames = allSkills.flatMap((f) => f({}).meta.tools);
  console.log(`  📊 总工具数: ${allToolNames.length} 个 (跨 10 个 Skill)`);
  assert(allToolNames.length >= 35, `总工具数 >= 35 (实际 ${allToolNames.length})`);
}

// ==================== 2. CronMaestro ====================

function testCronMaestro() {
  console.log("\n⏰ [2] CronMaestro — 自然语言定时调度");

  const testPath = "/tmp/jarvis-test-cron.json";
  try { fs.unlinkSync(testPath); } catch {}

  const cron = new CronMaestro({ dataPath: testPath });
  assert(cron !== null, "CronMaestro 初始化成功");

  // 2.1 自然语言解析
  const cases: Array<{ input: string; expected: string }> = [
    { input: "每天早上9点", expected: "0 9 * * *" },
    { input: "每天下午3点", expected: "0 15 * * *" },
    { input: "每隔30分钟", expected: "*/30 * * * *" },
    { input: "每隔2小时", expected: "0 */2 * * *" },
    { input: "每小时", expected: "0 * * * *" },
    { input: "每周一", expected: "0 9 * * 1" },
    { input: "工作日每天10点", expected: "0 10 * * 1-5" },
    { input: "每月15号", expected: "0 9 15 * *" },
    { input: "每3天", expected: "0 9 */3 * *" },
  ];

  for (const { input, expected } of cases) {
    const result = cron.parseNaturalLanguage(input);
    assert(result.cronExpression === expected, `"${input}" → ${result.cronExpression}`);
  }

  // 直接 Cron 表达式
  const directCron = cron.parseNaturalLanguage("0 9 * * *");
  assert(directCron.cronExpression === "0 9 * * *", "直接 Cron 表达式识别");

  // 无法解析
  const unknown = cron.parseNaturalLanguage("明天天气怎么样");
  assert(unknown.cronExpression === null, "无法解析返回 null");

  // 2.2 创建任务
  const task = cron.createTask("每天早上9点", "帮我发一篇小红书");
  assert(task !== null, "自然语言创建任务成功");
  assert(task!.cronExpression === "0 9 * * *", `任务 Cron = ${task!.cronExpression}`);
  assert(task!.status === "active", "任务状态 = active");
  assert(task!.instruction === "帮我发一篇小红书", "指令正确");

  const task2 = cron.createTaskWithCron("*/5 * * * *", "检查账号状态", "每5分钟检查");
  assert(task2.cronExpression === "*/5 * * * *", "Cron 表达式创建任务");

  // 2.3 任务管理
  assert(cron.listTasks().length === 2, "列出 2 个任务");
  assert(cron.listTasks("active").length === 2, "活跃任务 2 个");

  cron.pauseTask(task!.id);
  assert(cron.getTask(task!.id)?.status === "paused", "暂停任务成功");
  assert(cron.listTasks("paused").length === 1, "暂停任务 1 个");

  cron.resumeTask(task!.id);
  assert(cron.getTask(task!.id)?.status === "active", "恢复任务成功");

  cron.deleteTask(task2.id);
  assert(cron.listTasks().length === 1, "删除后剩 1 个任务");

  // 2.4 下次执行时间
  const nextRun = cron.getNextRunTime("0 9 * * *");
  assert(nextRun !== null, "计算下次执行时间");
  assert(nextRun!.getHours() === 9, `下次执行时间小时 = ${nextRun!.getHours()}`);

  // 2.5 状态
  const status = cron.getStatus();
  assert(status.totalTasks === 1, `总任务 = ${status.totalTasks}`);
  assert(status.active === 1, `活跃 = ${status.active}`);
}

// ==================== 3. EventBus ====================

async function testEventBus() {
  console.log("\n📡 [3] EventBus — 统一事件系统");

  resetEventBus();
  const bus = new EventBus();
  assert(bus !== null, "EventBus 初始化成功");

  // 3.1 基本发布/订阅
  let received = false;
  bus.on("publish:success", (data) => {
    received = true;
    assert(data.platform === "xiaohongshu", "事件数据正确");
  });

  await bus.emit("publish:success", {
    platform: "xiaohongshu",
    title: "测试文章",
    url: "https://example.com",
  });
  assert(received, "事件被正确接收");

  // 3.2 once 一次性监听
  let onceCount = 0;
  bus.once("tool:start", () => { onceCount++; });
  await bus.emit("tool:start", { tool: "test-tool", params: {} });
  await bus.emit("tool:start", { tool: "test-tool", params: {} });
  assert(onceCount === 1, "once 只触发一次");

  // 3.3 通配符监听
  let anyCount = 0;
  const unsub = bus.onAny(() => { anyCount++; });
  await bus.emit("log:info", { message: "测试日志" });
  await bus.emit("log:warn", { message: "测试警告" });
  assert(anyCount === 2, "通配符监听到 2 个事件");
  unsub(); // 取消订阅

  // 3.4 事件历史
  const history = bus.getHistory({ limit: 5 });
  assert(history.length > 0, `事件历史 ${history.length} 条`);

  const publishHistory = bus.getHistory({ eventName: "publish:success" });
  assert(publishHistory.length === 1, "按事件名过滤历史");

  // 3.5 中间件
  let middlewareCalled = false;
  bus.use((eventName, data, meta, next) => {
    middlewareCalled = true;
    if (eventName === "safety:blocked") {
      // 拦截，不调用 next
      return;
    }
    next();
  });

  let safetyReceived = false;
  bus.on("safety:blocked", () => { safetyReceived = true; });
  await bus.emit("safety:blocked", { platform: "test", reason: "测试", riskScore: 80 });
  assert(middlewareCalled, "中间件被调用");
  assert(safetyReceived === false, "中间件拦截了事件");

  // 3.6 取消订阅
  let cancelCount = 0;
  const cancelFn = bus.on("log:info", () => { cancelCount++; });
  await bus.emit("log:info", { message: "before cancel" });
  cancelFn();
  await bus.emit("log:info", { message: "after cancel" });
  assert(cancelCount === 1, "取消订阅后不再触发");

  // 3.7 状态
  const busStatus = bus.getStatus();
  assert(busStatus.listenerCount > 0, `监听器数 = ${busStatus.listenerCount}`);
  assert(busStatus.historySize > 0, `历史记录 = ${busStatus.historySize}`);
  assert(busStatus.middlewareCount === 1, `中间件数 = ${busStatus.middlewareCount}`);
}

// ==================== 4. PluginSDK ====================

async function testPluginSDK() {
  console.log("\n🔌 [4] PluginSDK — 第三方开发者套件");

  // 4.1 创建插件
  const weatherPlugin = PluginSDK.createPlugin({
    name: "weather-checker",
    version: "1.0.0",
    description: "天气查询插件",
    author: "test-dev",
    category: "workflow",
    tags: ["天气", "weather"],
    triggers: ["天气", "weather"],
    tools: [
      {
        name: "check-weather",
        description: "查询指定城市天气",
        params: {
          city: { type: "string", description: "城市名", required: true },
          days: { type: "number", description: "预报天数", required: false, default: 3 },
        },
        handler: async (params, ctx) => {
          ctx.log(`查询天气: ${params.city}`);
          return {
            success: true,
            data: {
              city: params.city,
              temperature: 22,
              weather: "晴",
              days: params.days,
            },
          };
        },
      },
      {
        name: "weather-alert",
        description: "天气预警",
        params: {
          region: { type: "string", description: "区域", required: true },
        },
        handler: async (params) => {
          return {
            success: true,
            data: { region: params.region, alerts: [] },
          };
        },
      },
    ],
  });

  assert(typeof weatherPlugin === "function", "createPlugin 返回 SkillFactory");

  const skill = weatherPlugin({});
  assert(skill.meta.name === "weather-checker", "插件名称正确");
  assert(skill.meta.tools.length === 2, "2 个工具");

  // 4.2 激活并执行
  await skill.activate({});
  assert(skill.tools.length === 2, "激活后工具数 = 2");

  const result = await skill.tools[0].execute({ city: "北京" });
  assert(result.success === true, "工具执行成功");
  assert((result.data as Record<string, unknown>).city === "北京", "返回数据正确");
  assert((result.data as Record<string, unknown>).days === 3, "默认值生效");

  // 4.3 参数验证
  const badResult = await skill.tools[0].execute({});
  assert(badResult.success === false, "缺少必填参数被拒绝");

  // 4.4 测试框架
  const testReport = await PluginSDK.runTests(weatherPlugin, [
    {
      name: "查询北京天气",
      tool: "check-weather",
      params: { city: "北京" },
      expect: { success: true },
    },
    {
      name: "查询天气预警",
      tool: "weather-alert",
      params: { region: "华北" },
      expect: { success: true },
    },
    {
      name: "缺少必填参数",
      tool: "check-weather",
      params: {},
      expect: { success: false },
    },
  ]);

  assert(testReport.total === 3, `测试总数 = ${testReport.total}`);
  assert(testReport.passed === 3, `测试通过 = ${testReport.passed}`);
  assert(testReport.failed === 0, `测试失败 = ${testReport.failed}`);

  // 4.5 脚手架生成
  const scaffold = PluginSDK.generateScaffold("my-skill", ["tool-a", "tool-b"]);
  assert(scaffold.includes("my-skill"), "脚手架包含插件名");
  assert(scaffold.includes("tool-a"), "脚手架包含工具名");
  assert(scaffold.includes("PluginSDK.createPlugin"), "脚手架使用 PluginSDK");

  // 4.6 package.json 模板
  const pkgJson = PluginSDK.generatePackageJson("my-skill");
  const pkg = JSON.parse(pkgJson);
  assert(pkg.name === "@jarvis-skills/my-skill", "包名正确");
  assert(pkg.peerDependencies["@jarvis/agent-core"] === ">=4.0.0", "peer 依赖正确");

  // 4.7 验证错误
  let validationError = false;
  try {
    PluginSDK.createPlugin({
      name: "",
      version: "1.0.0",
      description: "",
      author: "",
      tools: [],
    });
  } catch {
    validationError = true;
  }
  assert(validationError, "无效定义抛出错误");
}

// ==================== 5. SaaS TenantManager ====================

function testSaasManager() {
  console.log("\n🏢 [5] TenantManager — SaaS 多租户");

  const testPath = "/tmp/jarvis-test-saas.json";
  try { fs.unlinkSync(testPath); } catch {}

  const mgr = new TenantManager({ dataPath: testPath });
  assert(mgr !== null, "TenantManager 初始化成功");

  // 5.1 创建用户
  const tenant = mgr.createTenant("alice@example.com", "Alice", "starter");
  assert(tenant.email === "alice@example.com", "邮箱正确");
  assert(tenant.plan === "starter", "套餐 = starter");
  assert(tenant.apiKeys.length === 1, "默认 API Key 1 个");
  assert(tenant.apiKeys[0].key.startsWith("jvs_"), "Key 格式正确");
  assert(tenant.status === "active", "状态 = active");

  // 5.2 邮箱唯一
  let dupError = false;
  try { mgr.createTenant("alice@example.com", "Alice2"); } catch { dupError = true; }
  assert(dupError, "重复邮箱被拒绝");

  // 5.3 认证
  const apiKey = tenant.apiKeys[0].key;
  const authed = mgr.authenticate(apiKey);
  assert(authed !== null, "API Key 认证成功");
  assert(authed!.id === tenant.id, "认证返回正确用户");

  const badAuth = mgr.authenticate("invalid-key");
  assert(badAuth === null, "无效 Key 认证失败");

  // 5.4 权限检查
  assert(mgr.hasPermission(apiKey, "read") === true, "有 read 权限");
  assert(mgr.hasPermission(apiKey, "publish") === true, "有 publish 权限");
  assert(mgr.hasPermission(apiKey, "admin") === false, "无 admin 权限");

  // 5.5 创建额外 Key
  const newKey = mgr.createApiKey(tenant.id, "CI/CD Key", ["read"]);
  assert(newKey !== null, "创建新 Key 成功");
  assert(mgr.hasPermission(newKey!, "read") === true, "新 Key 有 read");
  assert(mgr.hasPermission(newKey!, "write") === false, "新 Key 无 write");

  // 5.6 吊销 Key
  assert(mgr.revokeApiKey(tenant.id, newKey!) === true, "吊销 Key 成功");
  assert(mgr.authenticate(newKey!) === null, "吊销后无法认证");

  // 5.7 配额检查
  const quota = mgr.checkQuota(tenant.id, "publishes");
  assert(quota.allowed === true, "发布配额允许");
  assert(quota.remaining === 200, `剩余发布次数 = ${quota.remaining}`);

  // 记录用量
  mgr.recordUsage(tenant.id, "publishes", 5);
  mgr.recordUsage(tenant.id, "api_calls", 100);
  const quota2 = mgr.checkQuota(tenant.id, "publishes");
  assert(quota2.remaining === 195, `使用后剩余 = ${quota2.remaining}`);

  // 5.8 配额状态
  const quotaStatus = mgr.getQuotaStatus(tenant.id);
  assert(quotaStatus.length > 0, `配额项 ${quotaStatus.length} 个`);
  const publishQuota = quotaStatus.find((q) => q.type === "publishes");
  assert(publishQuota?.used === 5, "发布用量 = 5");

  // 5.9 升级套餐
  mgr.upgradePlan(tenant.id, "pro");
  const upgraded = mgr.getTenant(tenant.id);
  assert(upgraded?.plan === "pro", "升级到 pro");
  const proQuota = mgr.checkQuota(tenant.id, "publishes");
  assert(proQuota.remaining === 995, `pro 套餐剩余 = ${proQuota.remaining}`);

  // 5.10 企业版无限配额
  const enterprise = mgr.createTenant("bob@corp.com", "Bob", "enterprise");
  const entQuota = mgr.checkQuota(enterprise.id, "api_calls");
  assert(entQuota.allowed === true, "企业版配额允许");
  assert(entQuota.remaining === 999999, "企业版无限配额");

  // 5.11 月度账单
  mgr.recordUsage(tenant.id, "publishes", 1000); // 触发超额
  const bill = mgr.generateBill(tenant.id);
  assert(bill !== null, "生成账单成功");
  assert(bill!.plan === "pro", "账单套餐 = pro");
  assert(bill!.basePriceCents === 9900, "基础费 $99");
  assert(bill!.totalCents >= 9900, `总费用 = ${bill!.totalCents} 分`);
  console.log(`  📊 月度账单: 基础 $${(bill!.basePriceCents / 100).toFixed(2)} + 超额 $${((bill!.totalCents - bill!.basePriceCents) / 100).toFixed(2)} = $${(bill!.totalCents / 100).toFixed(2)}`);

  // 5.12 套餐信息
  const plans = mgr.getPlans();
  assert(plans.length === 4, `套餐数 = ${plans.length}`);
  assert(plans[0].plan === "free", "free 套餐");
  assert(plans[3].plan === "enterprise", "enterprise 套餐");

  // 5.13 设置更新
  mgr.updateSettings(tenant.id, { safetyLevel: "strict", timezone: "Asia/Shanghai" });
  const settings = mgr.getTenant(tenant.id)?.settings;
  assert(settings?.safetyLevel === "strict", "安全级别设置生效");
  assert(settings?.timezone === "Asia/Shanghai", "时区设置生效");

  // 5.14 暂停账户
  mgr.suspendTenant(tenant.id);
  assert(mgr.authenticate(apiKey) === null, "暂停后无法认证");

  // 5.15 统计
  const saasStatus = mgr.getStatus();
  assert(saasStatus.totalTenants === 2, `总租户 = ${saasStatus.totalTenants}`);
  assert(saasStatus.activeTenants === 1, `活跃租户 = ${saasStatus.activeTenants}`);
}

// ==================== 6. 集成测试 ====================

async function testIntegration() {
  console.log("\n🔗 [6] 集成测试 — EventBus × CronMaestro × SaaS");

  resetEventBus();
  const bus = new EventBus();
  const testCronPath = "/tmp/jarvis-test-integration-cron.json";
  const testSaasPath = "/tmp/jarvis-test-integration-saas.json";
  try { fs.unlinkSync(testCronPath); } catch {}
  try { fs.unlinkSync(testSaasPath); } catch {}

  const cronEvents: string[] = [];

  // 事件监听
  bus.on("cron:created", (data) => { cronEvents.push(`created:${data.taskId}`); });
  bus.on("cron:executed", (data) => { cronEvents.push(`executed:${data.taskId}`); });

  // 模拟完整 SaaS 流程
  const mgr = new TenantManager({ dataPath: testSaasPath });
  const tenant = mgr.createTenant("integration@test.com", "Integration User", "pro");
  const apiKey = tenant.apiKeys[0].key;

  // Step 1: 认证
  const authed = mgr.authenticate(apiKey);
  assert(authed !== null, "Step 1: 认证通过");

  // Step 2: 检查配额
  const quota = mgr.checkQuota(tenant.id, "publishes");
  assert(quota.allowed === true, "Step 2: 配额允许");

  // Step 3: 创建定时任务 + 事件通知
  const cron = new CronMaestro({ dataPath: testCronPath });
  const task = cron.createTask("每天早上9点", "帮我发一篇小红书");
  await bus.emit("cron:created", {
    taskId: task!.id,
    description: task!.description,
    cron: task!.cronExpression,
  });

  assert(cronEvents.length === 1, "Step 3: 事件已触发");
  assert(cronEvents[0].startsWith("created:"), "Step 3: 创建事件正确");

  // Step 4: 记录用量
  mgr.recordUsage(tenant.id, "publishes", 1);
  mgr.recordUsage(tenant.id, "api_calls", 3);

  const monthlyUsage = mgr.getMonthlyUsage(tenant.id);
  assert(monthlyUsage === 4, `Step 4: 月度总用量 = ${monthlyUsage}`);

  console.log("\n  🎯 完整 SaaS 流程模拟:");
  console.log(`     认证: ✅ ${tenant.email}`);
  console.log(`     配额: ${quota.remaining} 次发布可用`);
  console.log(`     定时: ${task!.description} → ${task!.cronExpression}`);
  console.log(`     用量: ${monthlyUsage} 次 API 调用`);
}

// ==================== 运行 ====================

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Phase 5 端到端测试");
  console.log("  BrowserPilot + CronMaestro + EventBus + SDK + SaaS");
  console.log("═══════════════════════════════════════════════════════════");

  testBrowserPilot();
  testCronMaestro();
  await testEventBus();
  await testPluginSDK();
  testSaasManager();
  await testIntegration();

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log(`  结果: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log("═══════════════════════════════════════════════════════════\n");

  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch(console.error);
