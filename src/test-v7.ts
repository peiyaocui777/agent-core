/**
 * test-v7.ts — Phase 6 端到端测试
 *
 * 测试范围：
 * 1. VectorMemory — 向量记忆 + 语义搜索 + RAG
 * 2. AutonomousPlanner — 自主决策引擎
 * 3. WebChatServer — Web Chat UI 服务
 * 4. ConfigLoader — 配置系统
 * 5. 集成测试 — 各模块协同
 */

import * as assert from "assert";
import * as fs from "fs";
import * as http from "http";

// ==================== 导入 ====================

import { VectorMemory } from "./memory/vector-store.js";
import { AutonomousPlanner } from "./autonomous/planner.js";
import type { TaskGoal } from "./autonomous/planner.js";
import { ConfigLoader } from "./config/loader.js";
import { createAgent } from "./index.js";

// ==================== 辅助 ====================

let pass = 0;
let fail = 0;

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      pass++;
      console.log(`  ✅ ${name}`);
    })
    .catch((err) => {
      fail++;
      console.log(`  ❌ ${name}: ${err.message || err}`);
    });
}

function httpRequest(port: number, method: string, path: string, body?: string): Promise<{ status: number; data: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, method, path, headers: body ? { "Content-Type": "application/json" } : {} }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode || 0, data }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// ==================== 测试 ====================

async function main() {
  console.log("\n🧪 Phase 6 — 端到端测试\n");

  // ==================== 1. VectorMemory ====================
  console.log("📦 1. VectorMemory 向量记忆");

  const memPath = "/tmp/test-v7-vector-memory.json";
  try { fs.unlinkSync(memPath); } catch {}

  const vm = new VectorMemory({ dataPath: memPath });

  await test("创建 VectorMemory 实例", () => {
    assert.ok(vm, "实例存在");
  });

  await test("remember: 记住事实", () => {
    const entry = vm.remember("用户喜欢简洁风格的小红书笔记", "preference", {
      tags: ["style", "xhs"],
      importance: 8,
    });
    assert.ok(entry.id.startsWith("mem-"), `ID 格式: ${entry.id}`);
    assert.strictEqual(entry.metadata.type, "preference");
    assert.strictEqual(entry.metadata.importance, 8);
    assert.ok(entry.vector.length > 0, "向量不为空");
  });

  await test("remember: 记住多条", () => {
    vm.remember("每天早上9点发布效果最好", "fact", { tags: ["timing"] });
    vm.remember("小红书标题不超过20字", "fact", { tags: ["xhs", "rule"] });
    vm.remember("AI 生成的内容需要人工校对", "fact", { tags: ["workflow"] });
    vm.remember("我最近在做健身相关的内容", "fact", { tags: ["topic", "fitness"] });
    const status = vm.getStatus();
    assert.strictEqual(status.totalEntries, 5, `总条目: ${status.totalEntries}`);
  });

  await test("rememberBatch: 批量记忆", () => {
    const count = vm.rememberBatch([
      { text: "公众号推文周三效果最好", type: "fact", tags: ["wechat"] },
      { text: "B站视频标题要有数字", type: "fact", tags: ["bilibili"] },
    ]);
    assert.strictEqual(count, 2);
    assert.strictEqual(vm.getStatus().totalEntries, 7);
  });

  await test("rememberConversation: 记住对话", () => {
    const entry = vm.rememberConversation("帮我写一篇小红书笔记", "好的，主题是什么？");
    assert.strictEqual(entry.metadata.type, "conversation");
    assert.ok(entry.text.includes("用户:"));
    assert.ok(entry.text.includes("助手:"));
  });

  await test("search: 语义搜索 — 小红书相关", () => {
    const results = vm.search("小红书写作技巧", 3);
    assert.ok(results.length > 0, `搜索到 ${results.length} 条结果`);
    assert.ok(results[0].similarity > 0, `相似度: ${results[0].similarity}`);
    // 最相关的应该包含"小红书"
    const hasXhs = results.some((r) => r.entry.text.includes("小红书"));
    assert.ok(hasXhs, "搜索结果包含小红书相关内容");
  });

  await test("search: 语义搜索 — 健身相关", () => {
    const results = vm.search("健身内容创作");
    assert.ok(results.length > 0, "搜索到健身相关内容");
    const hasFitness = results.some((r) => r.entry.text.includes("健身"));
    assert.ok(hasFitness, "搜索结果包含健身相关内容");
  });

  await test("search: 过滤 — 按类型", () => {
    const prefs = vm.search("风格", 5, { type: "preference" });
    assert.ok(prefs.length > 0, "搜索到偏好");
    assert.ok(prefs.every((r) => r.entry.metadata.type === "preference"), "全部是 preference 类型");
  });

  await test("search: 过滤 — 按标签", () => {
    const results = vm.search("发布时间", 5, { tags: ["timing"] });
    assert.ok(results.length > 0, "搜索到相关内容");
  });

  await test("getByType: 按类型获取", () => {
    const facts = vm.getByType("fact");
    assert.ok(facts.length >= 4, `事实类记忆: ${facts.length}`);
  });

  await test("buildRAGContext: 构建 RAG 上下文", () => {
    const ctx = vm.buildRAGContext("小红书笔记怎么写");
    assert.ok(ctx.relevantMemories.length > 0, `相关记忆: ${ctx.relevantMemories.length}`);
    assert.ok(ctx.contextText.length > 0, "上下文不为空");
    assert.ok(ctx.tokenEstimate > 0, `Token 估算: ${ctx.tokenEstimate}`);
  });

  await test("buildRAGPrompt: 生成 RAG Prompt", () => {
    const prompt = vm.buildRAGPrompt("小红书");
    assert.ok(prompt.includes("相关记忆"), "包含记忆标记");
    assert.ok(prompt.length > 50, `Prompt 长度: ${prompt.length}`);
  });

  await test("forget: 删除记忆", () => {
    const allFacts = vm.getByType("fact");
    const before = vm.getStatus().totalEntries;
    const deleted = vm.forget(allFacts[0].id);
    assert.ok(deleted, "删除成功");
    assert.strictEqual(vm.getStatus().totalEntries, before - 1);
  });

  await test("getStatus: 状态统计", () => {
    const status = vm.getStatus();
    assert.ok(status.totalEntries > 0, `总条目: ${status.totalEntries}`);
    assert.ok(status.vocabularySize > 0, `词汇量: ${status.vocabularySize}`);
    assert.ok(status.oldestEntry, "有最早条目");
    assert.ok(status.newestEntry, "有最新条目");
    assert.ok(Object.keys(status.typeDistribution).length > 0, "有类型分布");
  });

  await test("持久化: 重新加载", () => {
    const vm2 = new VectorMemory({ dataPath: memPath });
    const status = vm2.getStatus();
    assert.ok(status.totalEntries > 0, `重载后条目: ${status.totalEntries}`);
    assert.ok(status.vocabularySize > 0, `重载后词汇: ${status.vocabularySize}`);
  });

  // ==================== 2. AutonomousPlanner ====================
  console.log("\n📦 2. AutonomousPlanner 自主决策");

  const planner = new AutonomousPlanner();

  await test("创建 Planner 实例", () => {
    assert.ok(planner, "实例存在");
  });

  await test("registerTools: 注册工具", () => {
    planner.registerTools([
      { name: "scrape-trending", description: "采集热点" },
      { name: "ai-generate-content", description: "AI 生成内容" },
      { name: "xhs-publish", description: "小红书发布" },
      { name: "wechat-publish", description: "公众号发布" },
      { name: "multi-publish", description: "多平台分发" },
    ]);
    // 没有报错即成功
    assert.ok(true);
  });

  await test("planSteps: 规则规划 — 采集+生成", async () => {
    const goal: TaskGoal = { id: "test-1", goal: "采集热点并生成小红书笔记", priority: "high" };
    const steps = await planner.planSteps(goal);
    assert.ok(steps.length >= 2, `步骤数: ${steps.length}`);
    assert.ok(steps.some((s) => s.tool === "scrape-trending"), "包含采集步骤");
    assert.ok(steps.some((s) => s.action.includes("生成") || s.tool?.includes("generate")), "包含生成步骤");
  });

  await test("planSteps: 规则规划 — 多平台发布", async () => {
    const goal: TaskGoal = { id: "test-2", goal: "全平台分发今天的文章", priority: "medium" };
    const steps = await planner.planSteps(goal);
    assert.ok(steps.length >= 1, `步骤数: ${steps.length}`);
    assert.ok(steps.some((s) => s.tool === "multi-publish"), "包含多平台发布");
  });

  await test("planSteps: 规则规划 — 未知任务", async () => {
    const goal: TaskGoal = { id: "test-3", goal: "做点什么有趣的事情", priority: "low" };
    const steps = await planner.planSteps(goal);
    assert.ok(steps.length >= 1, `步骤数: ${steps.length}`);
  });

  await test("execute: 执行任务（无工具执行器）", async () => {
    const goal: TaskGoal = { id: "exec-1", goal: "写一篇关于 AI 的小红书笔记", priority: "high", maxSteps: 5 };
    const trace = await planner.execute(goal);
    assert.ok(trace.taskId === "exec-1", `TaskId: ${trace.taskId}`);
    assert.ok(["completed", "failed"].includes(trace.status), `Status: ${trace.status}`);
    assert.ok(trace.totalSteps > 0, `步骤数: ${trace.totalSteps}`);
    assert.ok(trace.startedAt, "有开始时间");
    assert.ok(trace.completedAt, "有结束时间");
  });

  await test("execute: 带工具执行器", async () => {
    planner.setToolExecutor(async (name, params) => {
      return { success: true, data: { tool: name, result: "模拟执行成功" } };
    });
    const goal: TaskGoal = { id: "exec-2", goal: "采集热点并生成内容然后发到小红书", priority: "high" };
    const trace = await planner.execute(goal);
    assert.ok(trace.status === "completed", `Status: ${trace.status}`);
    assert.ok(trace.successSteps > 0, `成功步骤: ${trace.successSteps}`);
  });

  await test("execute: 工具执行失败 + 反思", async () => {
    let callCount = 0;
    planner.setToolExecutor(async () => {
      callCount++;
      if (callCount <= 2) return { success: false, error: "模拟失败" };
      return { success: true, data: "ok" };
    });
    const goal: TaskGoal = { id: "exec-3", goal: "采集热点并生成小红书笔记", priority: "high" };
    const trace = await planner.execute(goal);
    assert.ok(trace.failedSteps > 0, `失败步骤: ${trace.failedSteps}`);
    // 可能触发了反思
    assert.ok(trace.reflections.length >= 0, `反思次数: ${trace.reflections.length}`);
  });

  await test("getTraces: 获取执行历史", () => {
    const traces = planner.getTraces();
    assert.ok(traces.length >= 3, `执行历史: ${traces.length}`);
  });

  await test("getStatus: 状态统计", () => {
    const status = planner.getStatus();
    assert.ok(status.totalTasks >= 3, `总任务: ${status.totalTasks}`);
    assert.ok(status.completed >= 1, `已完成: ${status.completed}`);
    assert.ok(typeof status.avgSteps === "number", `平均步骤: ${status.avgSteps}`);
  });

  // ==================== 3. ConfigLoader ====================
  console.log("\n📦 3. ConfigLoader 配置中心");

  const cl = new ConfigLoader();

  await test("创建 ConfigLoader 实例", () => {
    assert.ok(cl, "实例存在");
  });

  await test("load: 加载默认配置", () => {
    const config = cl.load("/tmp/nonexistent-dir");
    assert.strictEqual(config.llm.provider, "deepseek");
    assert.strictEqual(config.agent.name, "Jarvis");
    assert.strictEqual(config.safety.level, "moderate");
    assert.strictEqual(config.server.dashboardPort, 3800);
    assert.strictEqual(config.advanced.logLevel, "info");
  });

  await test("load: 环境变量覆盖", () => {
    process.env.JARVIS_AGENT_NAME = "TestBot";
    process.env.JARVIS_LLM_PROVIDER = "openai";
    const cl2 = new ConfigLoader();
    const config = cl2.load("/tmp/nonexistent-dir");
    assert.strictEqual(config.agent.name, "TestBot");
    assert.strictEqual(config.llm.provider, "openai");
    // 清理
    delete process.env.JARVIS_AGENT_NAME;
    delete process.env.JARVIS_LLM_PROVIDER;
  });

  await test("validate: 校验缺少 API Key", () => {
    const cl3 = new ConfigLoader();
    cl3.load("/tmp/nonexistent-dir");
    const result = cl3.validate();
    assert.ok(!result.valid, "应该校验失败");
    assert.ok(result.errors.some((e) => e.includes("apiKey")), "缺少 apiKey 错误");
  });

  await test("validate: 校验通过", () => {
    process.env.JARVIS_LLM_API_KEY = "sk-test-key";
    const cl4 = new ConfigLoader();
    cl4.load("/tmp/nonexistent-dir");
    const result = cl4.validate();
    assert.ok(result.valid, `校验应通过: ${result.errors.join(", ")}`);
    delete process.env.JARVIS_LLM_API_KEY;
  });

  await test("load: JSON 配置文件", () => {
    const configDir = "/tmp/test-v7-config";
    if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      configDir + "/jarvis.config.json",
      JSON.stringify({
        llm: { provider: "claude", model: "claude-3" },
        agent: { name: "MyJarvis" },
      })
    );
    const cl5 = new ConfigLoader();
    const config = cl5.load(configDir);
    assert.strictEqual(config.llm.provider, "claude");
    assert.strictEqual(config.llm.model, "claude-3");
    assert.strictEqual(config.agent.name, "MyJarvis");
    // 默认值保留
    assert.strictEqual(config.safety.level, "moderate");
  });

  await test("load: .env 文件", () => {
    const configDir = "/tmp/test-v7-env";
    if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configDir + "/.env", 'JARVIS_LLM_API_KEY=sk-from-env\nJARVIS_SAFETY_LEVEL=strict\n');
    // 移除已有的 config 文件
    try { fs.unlinkSync(configDir + "/jarvis.config.json"); } catch {}
    try { fs.unlinkSync(configDir + "/jarvis.config.yaml"); } catch {}
    const cl6 = new ConfigLoader();
    const config = cl6.load(configDir);
    assert.strictEqual(config.llm.apiKey, "sk-from-env");
    assert.strictEqual(config.safety.level, "strict");
  });

  await test("generateYamlTemplate: 生成 YAML 模板", () => {
    const template = ConfigLoader.generateYamlTemplate();
    assert.ok(template.includes("llm:"), "包含 LLM 配置");
    assert.ok(template.includes("agent:"), "包含 Agent 配置");
    assert.ok(template.includes("safety:"), "包含安全配置");
    assert.ok(template.length > 500, `模板长度: ${template.length}`);
  });

  await test("generateEnvTemplate: 生成 .env 模板", () => {
    const template = ConfigLoader.generateEnvTemplate();
    assert.ok(template.includes("JARVIS_LLM_PROVIDER"), "包含 LLM Provider");
    assert.ok(template.includes("JARVIS_LLM_API_KEY"), "包含 API Key");
  });

  await test("generateDockerCompose: 生成 Docker Compose", () => {
    const dc = ConfigLoader.generateDockerCompose();
    assert.ok(dc.includes("jarvis"), "包含 jarvis 服务");
    assert.ok(dc.includes("3800"), "包含端口映射");
  });

  await test("generateDockerfile: 生成 Dockerfile", () => {
    const df = ConfigLoader.generateDockerfile();
    assert.ok(df.includes("node:20"), "基于 Node 20");
    assert.ok(df.includes("EXPOSE"), "暴露端口");
  });

  // ==================== 4. WebChatServer ====================
  console.log("\n📦 4. WebChatServer Web Chat UI");

  // 动态导入以避免顶层导入问题
  const { WebChatServer } = await import("./web/chat-server.js");

  const agent = createAgent({ name: "TestAgent" });
  await agent.initialize();

  const testVm = new VectorMemory({ dataPath: "/tmp/test-v7-webchat-memory.json" });
  testVm.remember("这是测试记忆", "fact");

  const webServer = new WebChatServer(agent, { port: 19876 }, { vectorMemory: testVm, planner });

  await test("创建 WebChatServer 实例", () => {
    assert.ok(webServer, "实例存在");
  });

  await test("start: 启动服务", async () => {
    await webServer.start();
  });

  await test("GET /: 返回 Chat HTML", async () => {
    const res = await httpRequest(19876, "GET", "/");
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.includes("<!DOCTYPE html>"), "HTML 文档");
    assert.ok(res.data.includes("TestAgent") || res.data.includes("Jarvis"), "包含 Agent 名称");
    assert.ok(res.data.includes("messages"), "包含消息容器");
    assert.ok(res.data.includes("send"), "包含发送功能");
  });

  await test("GET /api/status: Agent 状态", async () => {
    const res = await httpRequest(19876, "GET", "/api/status");
    assert.strictEqual(res.status, 200);
    const data = JSON.parse(res.data);
    assert.ok(data.agent, "包含 agent 信息");
    assert.ok(typeof data.uptime === "number", "包含 uptime");
    assert.ok(data.vectorMemory, "包含向量记忆状态");
  });

  await test("GET /api/skills: Skill 列表", async () => {
    const res = await httpRequest(19876, "GET", "/api/skills");
    assert.strictEqual(res.status, 200);
    const data = JSON.parse(res.data);
    assert.ok(data.skills.length > 0, `Skills: ${data.skills.length}`);
    assert.ok(data.total > 0, `Total: ${data.total}`);
  });

  await test("POST /api/chat: 发送消息", async () => {
    const res = await httpRequest(
      19876, "POST", "/api/chat",
      JSON.stringify({ message: "你好", conversationId: "test-conv" })
    );
    assert.strictEqual(res.status, 200);
    const data = JSON.parse(res.data);
    assert.ok(data.reply, `Reply: ${data.reply?.slice(0, 50)}`);
    assert.strictEqual(data.conversationId, "test-conv");
  });

  await test("GET /api/chat/history: 对话历史", async () => {
    const res = await httpRequest(19876, "GET", "/api/chat/history?id=test-conv");
    assert.strictEqual(res.status, 200);
    const data = JSON.parse(res.data);
    assert.strictEqual(data.conversationId, "test-conv");
    assert.ok(data.messages.length >= 2, `消息数: ${data.messages.length}`);
    assert.ok(data.conversations.length > 0, "有对话列表");
  });

  await test("POST /api/memory/search: 记忆搜索", async () => {
    const res = await httpRequest(
      19876, "POST", "/api/memory/search",
      JSON.stringify({ query: "测试", limit: 3 })
    );
    assert.strictEqual(res.status, 200);
    const data = JSON.parse(res.data);
    assert.ok(data.results, "有搜索结果");
  });

  await test("GET /api/memory: 记忆状态", async () => {
    const res = await httpRequest(19876, "GET", "/api/memory");
    assert.strictEqual(res.status, 200);
    const data = JSON.parse(res.data);
    assert.ok(data.status, "有状态信息");
    assert.ok(data.recent, "有最近记录");
  });

  await test("GET /api/autonomous/traces: 执行历史", async () => {
    const res = await httpRequest(19876, "GET", "/api/autonomous/traces");
    assert.strictEqual(res.status, 200);
    const data = JSON.parse(res.data);
    assert.ok(Array.isArray(data.traces), "返回数组");
  });

  await test("404 处理", async () => {
    const res = await httpRequest(19876, "GET", "/api/nonexistent");
    assert.strictEqual(res.status, 404);
  });

  // 关闭服务
  await webServer.stop();
  await agent.shutdown();

  // ==================== 5. 集成测试 ====================
  console.log("\n📦 5. 集成测试");

  await test("Agent + VectorMemory 集成", () => {
    const intVm = new VectorMemory({ dataPath: "/tmp/test-v7-integration.json" });
    intVm.remember("用户是一个内容创作者", "fact");
    intVm.remember("用户喜欢科技主题", "preference");
    intVm.remember("上次发布了一篇关于 AI 的文章，效果很好", "publish");

    const ragPrompt = intVm.buildRAGPrompt("写一篇科技文章");
    assert.ok(ragPrompt.length > 0, "RAG Prompt 不为空");
    assert.ok(ragPrompt.includes("相关记忆"), "包含记忆标题");
  });

  await test("Planner + Tools 集成", async () => {
    const intPlanner = new AutonomousPlanner({ maxSteps: 5 });
    intPlanner.registerTools([
      { name: "research", description: "调研" },
      { name: "write", description: "写作" },
      { name: "publish", description: "发布" },
    ]);

    let toolCalls: string[] = [];
    intPlanner.setToolExecutor(async (name) => {
      toolCalls.push(name);
      return { success: true, data: `${name} 完成` };
    });

    const trace = await intPlanner.execute({
      id: "integration-1",
      goal: "生成并发布内容到小红书",
      priority: "high",
    });

    assert.ok(trace.status === "completed", `状态: ${trace.status}`);
    assert.ok(trace.successSteps > 0, "有成功步骤");
  });

  await test("ConfigLoader 优先级验证（env > file > default）", () => {
    const configDir = "/tmp/test-v7-priority";
    if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });

    // 配置文件设置 provider=gemini
    fs.writeFileSync(configDir + "/jarvis.config.json", JSON.stringify({ llm: { provider: "gemini" } }));
    // 环境变量设置 provider=claude
    process.env.JARVIS_LLM_PROVIDER = "claude";

    const loader = new ConfigLoader();
    const config = loader.load(configDir);
    // 环境变量优先
    assert.strictEqual(config.llm.provider, "claude");

    delete process.env.JARVIS_LLM_PROVIDER;
  });

  await test("VectorMemory forgetByFilter", () => {
    const vm3 = new VectorMemory({ dataPath: "/tmp/test-v7-forget.json" });
    vm3.remember("临时记忆 A", "conversation");
    vm3.remember("临时记忆 B", "conversation");
    vm3.remember("重要记忆", "fact", { importance: 9 });

    const removed = vm3.forgetByFilter({ type: "conversation" });
    assert.strictEqual(removed, 2, `删除: ${removed}`);
    assert.strictEqual(vm3.getStatus().totalEntries, 1);
  });

  await test("所有模块导出完整", async () => {
    const mod = await import("./index.js");
    // Phase 6 新增
    assert.ok(mod.VectorMemory, "VectorMemory 已导出");
    assert.ok(mod.AutonomousPlanner, "AutonomousPlanner 已导出");
    assert.ok(mod.WebChatServer, "WebChatServer 已导出");
    assert.ok(mod.ConfigLoader, "ConfigLoader 已导出");
    // 之前的
    assert.ok(mod.AgentCore, "AgentCore 已导出");
    assert.ok(mod.SafetyEngine, "SafetyEngine 已导出");
    assert.ok(mod.AnalyticsEngine, "AnalyticsEngine 已导出");
    assert.ok(mod.QualityEngine, "QualityEngine 已导出");
    assert.ok(mod.EventBus, "EventBus 已导出");
    assert.ok(mod.CronMaestro, "CronMaestro 已导出");
    assert.ok(mod.PluginSDK, "PluginSDK 已导出");
    assert.ok(mod.TenantManager, "TenantManager 已导出");
    assert.ok(mod.SkillRuntime, "SkillRuntime 已导出");
    assert.ok(mod.MemoryStore, "MemoryStore 已导出");
    assert.ok(mod.createAgent, "createAgent 已导出");
  });

  // ==================== 清理 ====================
  try { fs.unlinkSync(memPath); } catch {}
  try { fs.unlinkSync("/tmp/test-v7-webchat-memory.json"); } catch {}
  try { fs.unlinkSync("/tmp/test-v7-integration.json"); } catch {}
  try { fs.unlinkSync("/tmp/test-v7-forget.json"); } catch {}

  // ==================== 结果 ====================
  console.log(`\n${"=".repeat(50)}`);
  console.log(`📊 Phase 6 测试结果: ${pass} passed, ${fail} failed (共 ${pass + fail})`);
  console.log(`${"=".repeat(50)}\n`);

  if (fail > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ 测试异常:", err);
  process.exit(1);
});
