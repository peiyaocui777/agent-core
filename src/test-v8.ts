/**
 * test-v8.ts — Phase 7 端到端测试
 *
 * 测试范围：
 * 1. LLM Streaming（chatStream 接口）
 * 2. KnowledgeBase（文档导入/分块/查询/RAG）
 * 3. NotificationCenter（通知/规则/渠道）
 * 4. ConversationManager（CRUD/搜索/导出）
 * 5. DesktopBuilder（Tauri 配置生成）
 * 6. 集成测试
 */

import * as assert from "assert";
import * as fs from "fs";

import { KnowledgeBase } from "./knowledge/base.js";
import { NotificationCenter } from "./notification/center.js";
import { ConversationManager } from "./conversation/manager.js";
import { DesktopBuilder } from "./desktop/tauri-config.js";

// ==================== 辅助 ====================

let pass = 0;
let fail = 0;

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { pass++; console.log(`  ✅ ${name}`); })
    .catch((err) => { fail++; console.log(`  ❌ ${name}: ${err.message || err}`); });
}

// ==================== 测试 ====================

async function main() {
  console.log("\n🧪 Phase 7 — 端到端测试\n");

  // ==================== 1. KnowledgeBase ====================
  console.log("📦 1. KnowledgeBase 知识库");

  const kbPath = "/tmp/test-v8-knowledge.json";
  try { fs.unlinkSync(kbPath); } catch {}

  const kb = new KnowledgeBase({ dataPath: kbPath });

  await test("创建 KnowledgeBase 实例", () => {
    assert.ok(kb, "实例存在");
  });

  await test("addDocument: 导入文档", () => {
    const doc = kb.addDocument("AI 发展趋势", `
# AI 发展趋势 2025

## 大模型
GPT-5 预计将拥有更强的推理能力。DeepSeek 在开源领域持续领先。

## Agent 框架
AutoGPT、CrewAI、LangGraph 等框架正在快速迭代。
Agent 可以自主规划和执行多步任务。

## 多模态
图片、视频、音频的理解和生成能力大幅提升。
    `.trim(), { format: "md", tags: ["ai", "trend"] });

    assert.ok(doc.id.startsWith("doc-"), `ID: ${doc.id}`);
    assert.strictEqual(doc.title, "AI 发展趋势");
    assert.ok(doc.chunks.length > 0, `Chunks: ${doc.chunks.length}`);
    assert.ok(doc.metadata.wordCount > 50, `字数: ${doc.metadata.wordCount}`);
  });

  await test("addDocument: 导入纯文本", () => {
    const doc = kb.addDocument("小红书运营指南",
      "小红书笔记标题不超过20字。配图要清晰美观。发布时间最好在晚上8-10点。使用话题标签增加曝光。",
      { tags: ["xhs", "guide"] }
    );
    assert.ok(doc.chunks.length > 0);
  });

  await test("query: 语义查询 — AI 相关", () => {
    const results = kb.query("大模型发展方向", 3);
    assert.ok(results.length > 0, `结果: ${results.length}`);
    assert.ok(results[0].similarity > 0, `相似度: ${results[0].similarity}`);
    const hasAI = results.some((r) => r.chunk.includes("大模型") || r.chunk.includes("AI") || r.chunk.includes("GPT"));
    assert.ok(hasAI, "搜索结果包含 AI 相关内容");
  });

  await test("query: 语义查询 — 小红书", () => {
    const results = kb.query("小红书怎么发笔记");
    assert.ok(results.length > 0, "搜索到结果");
    const hasXhs = results.some((r) => r.chunk.includes("小红书"));
    assert.ok(hasXhs, "包含小红书内容");
  });

  await test("buildContext: 构建 RAG 上下文", () => {
    const ctx = kb.buildContext("Agent 框架有哪些");
    assert.ok(ctx.length > 0, `上下文长度: ${ctx.length}`);
    assert.ok(ctx.includes("["), "包含文档引用标记");
  });

  await test("listDocuments: 文档列表", () => {
    const docs = kb.listDocuments();
    assert.strictEqual(docs.length, 2, `文档数: ${docs.length}`);
    assert.ok(docs[0].title, "有标题");
    assert.ok(docs[0].chunkCount > 0, "有 chunk");
  });

  await test("searchByTag: 按标签搜索", () => {
    const docs = kb.searchByTag("ai");
    assert.ok(docs.length >= 1, `AI 标签文档: ${docs.length}`);
  });

  await test("removeDocument: 删除文档", () => {
    const docs = kb.listDocuments();
    const removed = kb.removeDocument(docs[1].id);
    assert.ok(removed, "删除成功");
    assert.strictEqual(kb.listDocuments().length, 1, "剩余 1 个文档");
  });

  await test("getStatus: 状态统计", () => {
    const status = kb.getStatus();
    assert.strictEqual(status.totalDocuments, 1);
    assert.ok(status.totalChunks > 0, `Chunks: ${status.totalChunks}`);
    assert.ok(status.vocabularySize > 0, `词汇: ${status.vocabularySize}`);
  });

  await test("持久化: 重新加载", () => {
    const kb2 = new KnowledgeBase({ dataPath: kbPath });
    assert.strictEqual(kb2.listDocuments().length, 1, "重载后文档数正确");
  });

  // ==================== 2. NotificationCenter ====================
  console.log("\n📦 2. NotificationCenter 通知中心");

  const notifPath = "/tmp/test-v8-notifications.json";
  try { fs.unlinkSync(notifPath); } catch {}

  const nc = new NotificationCenter({ dataPath: notifPath });

  await test("创建 NotificationCenter 实例", () => {
    assert.ok(nc, "实例存在");
  });

  await test("notify: 发送通知", () => {
    const n = nc.notify("info", "测试通知", "这是一条测试消息");
    assert.ok(n.id.startsWith("notif-"), `ID: ${n.id}`);
    assert.strictEqual(n.type, "info");
    assert.strictEqual(n.read, false);
  });

  await test("success/error/warning 快捷方法", () => {
    nc.success("发布成功", "小红书发布完成", "xhs");
    nc.error("发布失败", "B站连接超时", "bilibili");
    nc.warning("风险提醒", "今日发布量即将达到上限");
    assert.strictEqual(nc.getAll().length, 4);
  });

  await test("task: 任务通知", () => {
    const n = nc.task("新任务", "需要审核内容", [
      { label: "审核", action: "review", params: { id: "123" } },
      { label: "跳过", action: "skip" },
    ]);
    assert.ok(n.actions!.length === 2, "有 2 个操作按钮");
  });

  await test("reminder: 提醒", () => {
    nc.reminder("定时提醒", "该发布今日的内容了");
    assert.ok(nc.getAll().length >= 6);
  });

  await test("getUnread: 获取未读", () => {
    const unread = nc.getUnread();
    assert.strictEqual(unread.length, nc.getAll().length, "全部未读");
    assert.strictEqual(nc.getUnreadCount(), unread.length);
  });

  await test("markRead: 标记已读", () => {
    const all = nc.getAll();
    nc.markRead(all[0].id);
    assert.strictEqual(nc.getUnreadCount(), all.length - 1);
  });

  await test("markAllRead: 全部已读", () => {
    nc.markAllRead();
    assert.strictEqual(nc.getUnreadCount(), 0);
  });

  await test("getByType: 按类型获取", () => {
    const errors = nc.getByType("error");
    assert.strictEqual(errors.length, 1, "1 个错误通知");
  });

  await test("triggerByEvent: 事件触发通知", () => {
    const n = nc.triggerByEvent("publish:success", { platform: "小红书" });
    assert.ok(n, "规则匹配成功");
    assert.ok(n!.message.includes("小红书"), `消息: ${n!.message}`);
  });

  await test("triggerByEvent: 无匹配规则", () => {
    const n = nc.triggerByEvent("unknown:event");
    assert.strictEqual(n, null, "无匹配");
  });

  await test("delete: 删除通知", () => {
    const all = nc.getAll();
    const before = all.length;
    nc.delete(all[0].id);
    assert.strictEqual(nc.getAll().length, before - 1);
  });

  await test("registerChannel: 注册推送渠道", () => {
    let received: any = null;
    nc.registerChannel("websocket", (n) => { received = n; });
    nc.notify("info", "WebSocket 测试", "推送测试", { channels: ["websocket"] });
    assert.ok(received, "收到推送");
    assert.strictEqual(received.title, "WebSocket 测试");
  });

  await test("getRules: 获取规则列表", () => {
    const rules = nc.getRules();
    assert.ok(rules.length >= 5, `规则数: ${rules.length}`);
    assert.ok(rules.every((r) => r.id && r.event), "规则完整");
  });

  // ==================== 3. ConversationManager ====================
  console.log("\n📦 3. ConversationManager 对话管理器");

  const convPath = "/tmp/test-v8-conversations.json";
  try { fs.unlinkSync(convPath); } catch {}

  const cm = new ConversationManager({ dataPath: convPath });

  await test("创建 ConversationManager 实例", () => {
    assert.ok(cm, "实例存在");
  });

  await test("createConversation: 创建对话", () => {
    const conv = cm.createConversation("测试对话", ["test"]);
    assert.ok(conv.id.startsWith("conv-"), `ID: ${conv.id}`);
    assert.strictEqual(conv.title, "测试对话");
    assert.strictEqual(conv.tags[0], "test");
    assert.strictEqual(conv.pinned, false);
  });

  await test("addMessage: 添加消息", () => {
    const convs = cm.listConversations();
    const convId = convs[0].id;

    const msg1 = cm.addMessage(convId, "user", "你好，帮我写一篇小红书笔记");
    assert.ok(msg1, "消息添加成功");
    assert.strictEqual(msg1!.role, "user");

    const msg2 = cm.addMessage(convId, "assistant", "好的，请告诉我主题是什么？");
    assert.ok(msg2);

    const msg3 = cm.addMessage(convId, "user", "关于 AI 发展趋势");
    assert.ok(msg3);
  });

  await test("addMessage: 自动标题", () => {
    const conv2 = cm.createConversation();
    cm.addMessage(conv2.id, "user", "写一篇关于健身减脂的科普文章，要有数据支持");
    const updated = cm.getConversation(conv2.id);
    assert.ok(updated!.title.includes("健身"), `自动标题: ${updated!.title}`);
  });

  await test("listConversations: 列出对话", () => {
    const convs = cm.listConversations();
    assert.ok(convs.length >= 2, `对话数: ${convs.length}`);
    assert.ok(convs[0].messageCount > 0, "有消息");
  });

  await test("editMessage: 编辑消息", () => {
    const convs = cm.listConversations();
    const conv = cm.getConversation(convs[0].id)!;
    const msgId = conv.messages[0].id;
    const edited = cm.editMessage(conv.id, msgId, "修改后的内容");
    assert.ok(edited, "编辑成功");
    const updated = cm.getConversation(conv.id)!;
    assert.strictEqual(updated.messages[0].content, "修改后的内容");
    assert.strictEqual(updated.messages[0].edited, true);
  });

  await test("deleteMessage: 删除消息", () => {
    const convs = cm.listConversations();
    const conv = cm.getConversation(convs[0].id)!;
    const before = conv.messages.length;
    const deleted = cm.deleteMessage(conv.id, conv.messages[before - 1].id);
    assert.ok(deleted, "删除成功");
    const updated = cm.getConversation(conv.id)!;
    assert.strictEqual(updated.messages.length, before - 1);
  });

  await test("togglePin: 置顶", () => {
    const convs = cm.listConversations();
    cm.togglePin(convs[0].id);
    const updated = cm.getConversation(convs[0].id)!;
    assert.strictEqual(updated.pinned, true);
  });

  await test("toggleArchive: 归档", () => {
    const convs = cm.listConversations();
    const secondId = convs[convs.length - 1].id;
    cm.toggleArchive(secondId);
    const updated = cm.getConversation(secondId)!;
    assert.strictEqual(updated.archived, true);
  });

  await test("addTag: 添加标签", () => {
    const convs = cm.listConversations();
    cm.addTag(convs[0].id, "important");
    const updated = cm.getConversation(convs[0].id)!;
    assert.ok(updated.tags.includes("important"));
  });

  await test("rename: 重命名", () => {
    const convs = cm.listConversations();
    cm.rename(convs[0].id, "新标题");
    const updated = cm.getConversation(convs[0].id)!;
    assert.strictEqual(updated.title, "新标题");
  });

  await test("setSummary: 设置摘要", () => {
    const convs = cm.listConversations();
    cm.setSummary(convs[0].id, "这是关于小红书笔记的对话");
    const updated = cm.getConversation(convs[0].id)!;
    assert.strictEqual(updated.summary, "这是关于小红书笔记的对话");
  });

  await test("searchMessages: 全局搜索", () => {
    // 之前 editMessage 修改了内容，搜索"修改后"
    const results = cm.searchMessages("修改后");
    assert.ok(results.length > 0, `搜索结果: ${results.length}`);
    assert.ok(results[0].conversationTitle, "有对话标题");
  });

  await test("listConversations: 过滤搜索", () => {
    const pinned = cm.listConversations({ pinned: true });
    assert.ok(pinned.length >= 1, "有置顶对话");

    const byTag = cm.listConversations({ tags: ["test"] });
    assert.ok(byTag.length >= 1, "有标签过滤结果");
  });

  await test("exportConversation: JSON 导出", () => {
    const convs = cm.listConversations();
    const json = cm.exportConversation(convs[0].id, "json");
    assert.ok(json.length > 0, "有导出内容");
    const parsed = JSON.parse(json);
    assert.ok(parsed.id, "有效 JSON");
  });

  await test("exportConversation: Markdown 导出", () => {
    const convs = cm.listConversations();
    const md = cm.exportConversation(convs[0].id, "markdown");
    assert.ok(md.includes("#"), "Markdown 格式");
    assert.ok(md.includes("---"), "有分隔符");
  });

  await test("exportConversation: TXT 导出", () => {
    const convs = cm.listConversations();
    const txt = cm.exportConversation(convs[0].id, "txt");
    assert.ok(txt.includes("[user]") || txt.includes("[assistant]"), "有角色标记");
  });

  await test("deleteConversation: 删除对话", () => {
    const before = cm.listConversations().length;
    const convs = cm.listConversations();
    cm.deleteConversation(convs[convs.length - 1].id);
    assert.strictEqual(cm.listConversations().length, before - 1);
  });

  await test("getStatus: 统计", () => {
    const status = cm.getStatus();
    assert.ok(status.totalConversations > 0, `对话数: ${status.totalConversations}`);
    assert.ok(status.totalMessages > 0, `消息数: ${status.totalMessages}`);
    assert.ok(status.pinnedCount >= 1, "有置顶");
  });

  await test("持久化: 重新加载", () => {
    const cm2 = new ConversationManager({ dataPath: convPath });
    assert.ok(cm2.listConversations().length > 0, "重载后有数据");
  });

  // ==================== 4. DesktopBuilder ====================
  console.log("\n📦 4. DesktopBuilder 桌面端");

  const db = new DesktopBuilder({ appName: "TestJarvis", version: "1.0.0" });
  const desktopDir = "/tmp/test-v8-desktop";

  await test("创建 DesktopBuilder 实例", () => {
    assert.ok(db, "实例存在");
    const cfg = db.getConfig();
    assert.strictEqual(cfg.appName, "TestJarvis");
    assert.strictEqual(cfg.systemTray, true);
    assert.strictEqual(cfg.globalShortcut, "CmdOrCtrl+Shift+J");
  });

  await test("generateProject: 生成 Tauri 项目", () => {
    const result = db.generateProject(desktopDir);
    assert.ok(result.files.length >= 3, `生成文件: ${result.files.length}`);
    assert.ok(result.instructions.includes("快速开始"), "包含说明");
    assert.ok(result.instructions.includes("Rust"), "提到 Rust");
  });

  await test("生成文件检查: tauri.conf.json", () => {
    const confPath = `${desktopDir}/src-tauri/tauri.conf.json`;
    assert.ok(fs.existsSync(confPath), "文件存在");
    const conf = JSON.parse(fs.readFileSync(confPath, "utf-8"));
    assert.strictEqual(conf.productName, "TestJarvis");
    assert.ok(conf.app.windows[0].width === 1200);
    assert.ok(conf.app.trayIcon, "有系统托盘配置");
  });

  await test("生成文件检查: Cargo.toml", () => {
    const cargoPath = `${desktopDir}/src-tauri/Cargo.toml`;
    assert.ok(fs.existsSync(cargoPath), "文件存在");
    const content = fs.readFileSync(cargoPath, "utf-8");
    assert.ok(content.includes("tauri"), "包含 tauri 依赖");
    assert.ok(content.includes("tray-icon"), "包含托盘功能");
  });

  await test("生成文件检查: main.rs", () => {
    const mainPath = `${desktopDir}/src-tauri/src/main.rs`;
    assert.ok(fs.existsSync(mainPath), "文件存在");
    const content = fs.readFileSync(mainPath, "utf-8");
    assert.ok(content.includes("tauri::Builder"), "Tauri 入口");
    assert.ok(content.includes("tray"), "托盘代码");
  });

  await test("生成文件检查: start-desktop.sh", () => {
    const scriptPath = `${desktopDir}/start-desktop.sh`;
    assert.ok(fs.existsSync(scriptPath), "文件存在");
    const content = fs.readFileSync(scriptPath, "utf-8");
    assert.ok(content.includes("#!/bin/bash"), "shell 脚本");
    assert.ok(content.includes("3900"), "包含端口");
  });

  // ==================== 5. 集成测试 ====================
  console.log("\n📦 5. 集成测试");

  await test("KnowledgeBase + RAG 上下文构建", () => {
    const testKb = new KnowledgeBase({ dataPath: "/tmp/test-v8-kb-int.json" });
    testKb.addDocument("编程规范", "Python 代码应使用 PEP8 规范。变量名应有意义。", { tags: ["dev"] });
    testKb.addDocument("运营策略", "小红书发布要注意标题吸引力。配图选择很重要。", { tags: ["ops"] });

    const ctx = testKb.buildContext("代码规范");
    assert.ok(ctx.includes("PEP8") || ctx.includes("编程"), "上下文相关");

    try { fs.unlinkSync("/tmp/test-v8-kb-int.json"); } catch {}
  });

  await test("NotificationCenter + EventBus 集成", () => {
    const nc2 = new NotificationCenter({ dataPath: "/tmp/test-v8-nc-int.json" });

    // 模拟事件触发
    nc2.triggerByEvent("publish:success", { platform: "抖音" });
    nc2.triggerByEvent("task:completed", { taskName: "热点采集" });

    const all = nc2.getAll();
    assert.ok(all.length >= 2, `通知数: ${all.length}`);
    assert.ok(all.some((n) => n.message.includes("抖音")), "抖音通知");
    assert.ok(all.some((n) => n.message.includes("热点采集")), "任务通知");

    try { fs.unlinkSync("/tmp/test-v8-nc-int.json"); } catch {}
  });

  await test("ConversationManager + 导出集成", () => {
    const cm3 = new ConversationManager({ dataPath: "/tmp/test-v8-cm-int.json" });
    const conv = cm3.createConversation("集成测试");
    cm3.addMessage(conv.id, "user", "你好");
    cm3.addMessage(conv.id, "assistant", "你好！有什么可以帮你的？");
    cm3.addMessage(conv.id, "user", "写一篇文章");

    const md = cm3.exportConversation(conv.id, "markdown");
    assert.ok(md.includes("你好"), "Markdown 有内容");
    assert.ok(md.includes("---"), "Markdown 有分隔线");

    const results = cm3.searchMessages("文章");
    assert.ok(results.length >= 1, "搜索到消息");

    try { fs.unlinkSync("/tmp/test-v8-cm-int.json"); } catch {}
  });

  await test("所有 Phase 7 模块导出完整", async () => {
    const mod = await import("./index.js");
    // Phase 7 新增
    assert.ok(mod.KnowledgeBase, "KnowledgeBase");
    assert.ok(mod.NotificationCenter, "NotificationCenter");
    assert.ok(mod.ConversationManager, "ConversationManager");
    assert.ok(mod.DesktopBuilder, "DesktopBuilder");
    // 之前的
    assert.ok(mod.VectorMemory, "VectorMemory");
    assert.ok(mod.AutonomousPlanner, "AutonomousPlanner");
    assert.ok(mod.WebChatServer, "WebChatServer");
    assert.ok(mod.ConfigLoader, "ConfigLoader");
    assert.ok(mod.AgentCore, "AgentCore");
    assert.ok(mod.createAgent, "createAgent");
  });

  // ==================== 清理 ====================
  try { fs.unlinkSync(kbPath); } catch {}
  try { fs.unlinkSync(notifPath); } catch {}
  try { fs.unlinkSync(convPath); } catch {}
  try { fs.rmSync(desktopDir, { recursive: true }); } catch {}

  // ==================== 结果 ====================
  console.log(`\n${"=".repeat(50)}`);
  console.log(`📊 Phase 7 测试结果: ${pass} passed, ${fail} failed (共 ${pass + fail})`);
  console.log(`${"=".repeat(50)}\n`);

  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("❌ 测试异常:", err);
  process.exit(1);
});
