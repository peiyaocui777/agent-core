/**
 * test-v9.ts — Phase 8 端到端测试
 *
 * 测试范围：
 * 1. createJarvis() 一键启动 — 全模块串联
 * 2. jarvis.chat() 统一对话 — RAG + 知识库 + 安全 + 对话记录
 * 3. 模块互联验证
 * 4. 配置 → 模块 → 运行 全链路
 */

import * as assert from "assert";
import * as fs from "fs";
import * as http from "http";

// ==================== 辅助 ====================

let pass = 0;
let fail = 0;

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { pass++; console.log(`  ✅ ${name}`); })
    .catch((err) => { fail++; console.log(`  ❌ ${name}: ${err.message || err}`); });
}

function httpGet(port: number, path: string): Promise<{ status: number; data: string }> {
  return new Promise((resolve, reject) => {
    http.get({ hostname: "127.0.0.1", port, path }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode || 0, data }));
    }).on("error", reject);
  });
}

function httpPost(port: number, path: string, body: string): Promise<{ status: number; data: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, method: "POST", path, headers: { "Content-Type": "application/json" } }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode || 0, data }));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ==================== 测试 ====================

async function main() {
  console.log("\n🧪 Phase 8 — 端到端测试\n");

  // 清理数据
  const dataDir = "/tmp/test-v9-data";
  try { fs.rmSync(dataDir, { recursive: true }); } catch {}

  // ==================== 1. createJarvis() ====================
  console.log("📦 1. createJarvis() 一键启动");

  const { createJarvis } = await import("./bootstrap.js");

  let jarvis: Awaited<ReturnType<typeof createJarvis>>;

  await test("createJarvis 启动", async () => {
    jarvis = await createJarvis({
      dataDir,
      web: { port: 19877 },
      autoStartWeb: false,
    });
    assert.ok(jarvis, "实例存在");
  });

  await test("所有模块已创建", () => {
    assert.ok(jarvis.agent, "agent");
    assert.ok(jarvis.memory, "memory");
    assert.ok(jarvis.knowledge, "knowledge");
    assert.ok(jarvis.planner, "planner");
    assert.ok(jarvis.conversations, "conversations");
    assert.ok(jarvis.notifications, "notifications");
    assert.ok(jarvis.events, "events");
    assert.ok(jarvis.safety, "safety");
    assert.ok(jarvis.analytics, "analytics");
    assert.ok(jarvis.quality, "quality");
    assert.ok(jarvis.scheduler, "scheduler");
    assert.ok(jarvis.web, "web");
  });

  await test("getFullStatus: 全局状态", () => {
    const status = jarvis.getFullStatus();
    assert.strictEqual(status.version, "7.0.0");
    assert.ok(status.uptime >= 0, `Uptime: ${status.uptime}`);
    assert.ok(status.agent.skills > 0, `Skills: ${status.agent.skills}`);
    assert.ok(status.agent.tools > 0, `Tools: ${status.agent.tools}`);
  });

  // ==================== 2. 统一 chat ====================
  console.log("\n📦 2. jarvis.chat() 统一对话");

  await test("chat: 基本对话", async () => {
    const reply = await jarvis.chat("你好，你是谁？");
    assert.ok(reply.length > 0, `回复: ${reply.slice(0, 50)}`);
  });

  await test("chat: 对话被记忆", () => {
    const memStatus = jarvis.memory.getStatus();
    assert.ok(memStatus.totalEntries > 0, `记忆: ${memStatus.totalEntries}`);
  });

  await test("chat: 对话被记录到 ConversationManager", () => {
    const convStatus = jarvis.conversations.getStatus();
    assert.ok(convStatus.totalConversations > 0, `对话: ${convStatus.totalConversations}`);
    assert.ok(convStatus.totalMessages > 0, `消息: ${convStatus.totalMessages}`);
  });

  // ==================== 3. 知识库集成 ====================
  console.log("\n📦 3. 知识库集成");

  await test("添加知识文档", () => {
    jarvis.knowledge.addDocument("运营手册", "小红书笔记标题要吸引人。配图选择明亮色调。发布时间推荐晚上8点。", { tags: ["xhs"] });
    assert.strictEqual(jarvis.knowledge.getStatus().totalDocuments, 1);
  });

  await test("知识库影响 chat 上下文", async () => {
    // 知识库有小红书相关内容，chat 时会通过 RAG 注入
    const reply = await jarvis.chat("小红书怎么运营？");
    assert.ok(reply.length > 0, "有回复");
    // 知识库内容被记忆
    const memStatus = jarvis.memory.getStatus();
    assert.ok(memStatus.totalEntries >= 2, `记忆增长: ${memStatus.totalEntries}`);
  });

  // ==================== 4. 通知集成 ====================
  console.log("\n📦 4. 通知 + 事件集成");

  await test("事件 → 通知自动触发", () => {
    jarvis.events.emit("publish:success", { platform: "小红书", title: "测试文章" });
    const unread = jarvis.notifications.getUnreadCount();
    assert.ok(unread >= 1, `未读通知: ${unread}`);
  });

  await test("通知内容正确", () => {
    const all = jarvis.notifications.getAll();
    const pubNotif = all.find((n) => n.message.includes("小红书"));
    assert.ok(pubNotif, "有小红书通知");
    assert.strictEqual(pubNotif!.type, "success");
  });

  // ==================== 5. Web 服务 ====================
  console.log("\n📦 5. Web 服务集成");

  await test("startWeb: 启动 Web Chat", async () => {
    await jarvis.startWeb();
  });

  await test("GET /: Chat UI 页面", async () => {
    const res = await httpGet(19877, "/");
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.includes("<!DOCTYPE html>"), "HTML");
  });

  await test("GET /api/status: 含全部模块状态", async () => {
    const res = await httpGet(19877, "/api/status");
    assert.strictEqual(res.status, 200);
    const data = JSON.parse(res.data);
    assert.ok(data.agent, "agent 状态");
    assert.ok(data.vectorMemory, "向量记忆状态");
  });

  await test("GET /api/skills: Skill 列表", async () => {
    const res = await httpGet(19877, "/api/skills");
    assert.strictEqual(res.status, 200);
    const data = JSON.parse(res.data);
    assert.ok(data.total >= 10, `Skills: ${data.total}`);
  });

  await test("POST /api/chat: 对话 API", async () => {
    const res = await httpPost(19877, "/api/chat", JSON.stringify({ message: "你好", conversationId: "api-test" }));
    assert.strictEqual(res.status, 200);
    const data = JSON.parse(res.data);
    assert.ok(data.reply, "有回复");
  });

  await test("GET /api/conversations: 对话列表", async () => {
    const res = await httpGet(19877, "/api/conversations");
    assert.strictEqual(res.status, 200);
    const data = JSON.parse(res.data);
    assert.ok(data.conversations, "有对话列表");
  });

  await test("GET /api/notifications: 通知列表", async () => {
    const res = await httpGet(19877, "/api/notifications");
    assert.strictEqual(res.status, 200);
    const data = JSON.parse(res.data);
    assert.ok(typeof data.unreadCount === "number", `未读: ${data.unreadCount}`);
  });

  await test("GET /api/knowledge/status: 知识库状态", async () => {
    const res = await httpGet(19877, "/api/knowledge/status");
    assert.strictEqual(res.status, 200);
    const data = JSON.parse(res.data);
    assert.ok(data.status.totalDocuments >= 1, `文档: ${data.status.totalDocuments}`);
  });

  await test("POST /api/knowledge/query: 知识库查询", async () => {
    const res = await httpPost(19877, "/api/knowledge/query", JSON.stringify({ query: "运营", limit: 3 }));
    assert.strictEqual(res.status, 200);
    const data = JSON.parse(res.data);
    assert.ok(data.results, "有查询结果");
  });

  // ==================== 6. 数据持久化 ====================
  console.log("\n📦 6. 数据持久化");

  await test("数据目录存在", () => {
    assert.ok(fs.existsSync(dataDir), "数据目录存在");
  });

  await test("向量记忆文件", () => {
    assert.ok(fs.existsSync(`${dataDir}/vector-memory.json`), "文件存在");
  });

  await test("知识库文件", () => {
    assert.ok(fs.existsSync(`${dataDir}/knowledge.json`), "文件存在");
  });

  await test("对话文件", () => {
    assert.ok(fs.existsSync(`${dataDir}/conversations.json`), "文件存在");
  });

  await test("通知文件", () => {
    assert.ok(fs.existsSync(`${dataDir}/notifications.json`), "文件存在");
  });

  // ==================== 7. 模块导出完整 ====================
  console.log("\n📦 7. 完整性检查");

  await test("createJarvis 导出", async () => {
    const mod = await import("./index.js");
    assert.ok(mod.createJarvis, "createJarvis 已导出");
  });

  await test("所有 v8 模块导出", async () => {
    const mod = await import("./index.js");
    // v8 核心
    assert.ok(mod.createJarvis, "createJarvis");
    // v7
    assert.ok(mod.KnowledgeBase, "KnowledgeBase");
    assert.ok(mod.NotificationCenter, "NotificationCenter");
    assert.ok(mod.ConversationManager, "ConversationManager");
    assert.ok(mod.DesktopBuilder, "DesktopBuilder");
    // v6
    assert.ok(mod.VectorMemory, "VectorMemory");
    assert.ok(mod.AutonomousPlanner, "AutonomousPlanner");
    assert.ok(mod.WebChatServer, "WebChatServer");
    assert.ok(mod.ConfigLoader, "ConfigLoader");
    // 旧版
    assert.ok(mod.AgentCore, "AgentCore");
    assert.ok(mod.createAgent, "createAgent");
    assert.ok(mod.SafetyEngine, "SafetyEngine");
    assert.ok(mod.EventBus, "EventBus");
  });

  // ==================== 关闭 ====================
  await jarvis.shutdown();

  // 清理
  try { fs.rmSync(dataDir, { recursive: true }); } catch {}

  // ==================== 结果 ====================
  console.log(`\n${"=".repeat(50)}`);
  console.log(`📊 Phase 8 测试结果: ${pass} passed, ${fail} failed (共 ${pass + fail})`);
  console.log(`${"=".repeat(50)}\n`);

  if (fail > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ 测试异常:", err);
  process.exit(1);
});
