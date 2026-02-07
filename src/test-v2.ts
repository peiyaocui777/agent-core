/**
 * Agent Core v2 端到端测试
 *
 * 验证：
 * 1. Skills 系统（注册、激活、工具聚合）
 * 2. Memory 系统（记忆读写、画像、发布历史）
 * 3. Intent 引擎（LLM Fallback 模式）
 * 4. 完整工作流（自然语言 → 意图 → 执行）
 */

import { createAgent } from "./index.js";
import { MemoryStore } from "./memory/store.js";

// ==================== 测试用例 ====================

async function testSkillSystem(): Promise<boolean> {
  console.log("\n=== 测试 1: Skills 系统 ===\n");

  const agent = createAgent();
  await agent.initialize();

  // 检查 Skill 状态
  const status = agent.skills.getStatus();
  console.log(`  已加载 Skill: ${status.length}`);
  for (const s of status) {
    console.log(`    - ${s.name} (${s.category}) → ${s.toolCount} 工具 [${s.active ? "激活" : "未激活"}]`);
  }

  // 检查工具总数
  const tools = agent.getAllTools();
  console.log(`  总工具数: ${tools.length}`);
  console.log(`  工具列表: ${tools.map((t) => t.name).join(", ")}`);

  // 搜索 Skill
  const scrapeSkills = agent.skills.searchSkills("采集");
  console.log(`  搜索 "采集": ${scrapeSkills.length} 个匹配`);

  // 触发词匹配
  const matched = agent.skills.matchByTrigger("帮我搜索小红书热点");
  console.log(`  触发词匹配 "小红书热点": ${matched.map((m) => m.skill.meta.name).join(", ")}`);

  // 健康检查
  const health = await agent.skills.healthCheckAll();
  console.log(`  健康检查:`, Object.entries(health).map(([k, v]) => `${k}=${v.healthy}`).join(", "));

  // 获取 Skill Prompt
  const prompt = agent.skills.getSkillsPrompt();
  console.log(`  Skill Prompt 长度: ${prompt.length} 字符`);

  const ok = status.length === 5 && tools.length >= 12;
  console.log(ok ? "✅ Skills 系统正常" : "❌ Skills 系统异常");

  await agent.shutdown();
  return ok;
}

async function testMemorySystem(): Promise<boolean> {
  console.log("\n=== 测试 2: Memory 系统 ===\n");

  // 清理旧测试数据
  try {
    const fs = await import("fs");
    if (fs.existsSync("/tmp/jarvis-test-memory.json")) {
      fs.unlinkSync("/tmp/jarvis-test-memory.json");
    }
  } catch { /* ignore */ }

  const memory = new MemoryStore("/tmp/jarvis-test-memory.json");
  await memory.load();

  // 短期记忆
  memory.addMessage({ role: "user", content: "帮我写一篇关于AI的文章" });
  memory.addMessage({ role: "assistant", content: "好的，已生成AI相关内容" });
  const recent = memory.getRecentMessages(5);
  console.log(`  会话消息: ${recent.length} 条`);

  // 长期记忆
  memory.remember("favorite_topic", "AI副业", ["topic", "preference"]);
  memory.remember("writing_style", "轻松种草", ["style"]);
  const recalled = memory.recall("AI");
  console.log(`  回忆 "AI": ${recalled.length} 条 → ${recalled.map((r) => r.key).join(", ")}`);

  // 用户画像
  memory.updateProfile("nickname", "小鱼");
  memory.updateProfile("preferredTopics", ["AI", "副业", "效率"]);
  memory.updateProfile("platforms", ["xiaohongshu", "wechat"]);
  const profile = memory.getProfile();
  console.log(`  用户画像: ${JSON.stringify(profile)}`);

  // 画像 Prompt
  const profilePrompt = memory.getProfilePrompt();
  console.log(`  画像 Prompt: "${profilePrompt.slice(0, 80)}..."`);

  // 发布历史
  memory.logPublish({
    platform: "xiaohongshu",
    title: "AI副业入门指南",
    status: "success",
    url: "https://xhs.com/test",
  });
  memory.logPublish({
    platform: "wechat",
    title: "每天10分钟AI副业",
    status: "success",
  });
  memory.logPublish({
    platform: "douyin",
    title: "AI工具推荐",
    status: "failed",
  });

  const stats = memory.getPublishStats();
  console.log(`  发布统计: 总${stats.total}, 成功${stats.success}, 失败${stats.failed}`);
  console.log(`  平台分布:`, stats.byPlatform);

  // 持久化
  await memory.save();
  console.log("  已保存到 /tmp/jarvis-test-memory.json");

  // 验证重新加载
  const memory2 = new MemoryStore("/tmp/jarvis-test-memory.json");
  await memory2.load();
  const reloaded = memory2.recall("AI");
  console.log(`  重新加载后回忆 "AI": ${reloaded.length} 条`);

  const ok = recent.length === 2 && recalled.length >= 1 && stats.total === 3;
  console.log(ok ? "✅ Memory 系统正常" : "❌ Memory 系统异常");
  return ok;
}

async function testIntentEngine(): Promise<boolean> {
  console.log("\n=== 测试 3: Intent 引擎（Fallback 模式） ===\n");

  // 不配置 LLM API Key，测试 fallback
  const agent = createAgent();
  await agent.initialize();

  const testCases = [
    "帮我发一篇小红书关于AI副业的文章",
    "采集今天的热点话题",
    "帮我生成一篇关于健身的内容",
    "一键多平台发布所有平台",
    "今天天气怎么样",
  ];

  let allOk = true;

  for (const instruction of testCases) {
    const plan = await agent.parseInstruction(instruction);
    console.log(`  指令: "${instruction}"`);
    console.log(`    来源: ${plan.fromLLM ? "LLM" : "Fallback 正则"}`);
    console.log(`    步骤: ${plan.steps.length} → [${plan.steps.map((s) => s.toolName).join(" → ")}]`);
    if (plan.reasoning) {
      console.log(`    推理: ${plan.reasoning}`);
    }
    console.log();

    if (instruction.includes("小红书") && !plan.steps.some((s) => s.toolName.includes("xhs") || s.toolName.includes("generate"))) {
      allOk = false;
    }
  }

  console.log(allOk ? "✅ Intent 引擎正常" : "❌ Intent 引擎异常");
  await agent.shutdown();
  return allOk;
}

async function testFullWorkflow(): Promise<boolean> {
  console.log("\n=== 测试 4: 完整工作流 ===\n");

  const agent = createAgent();
  await agent.initialize();

  // 设置用户画像
  agent.memory.updateProfile("nickname", "小鱼");
  agent.memory.updateProfile("preferredTopics", ["AI", "副业"]);

  // 执行自然语言指令
  console.log('  指令: "帮我生成一篇关于AI副业的小红书笔记"');
  const task = await agent.run("帮我生成一篇关于AI副业的小红书笔记");
  console.log(`  任务状态: ${task.status}`);
  console.log(`  步骤数: ${task.steps.length}`);

  for (const step of task.steps) {
    console.log(`    [${step.status}] ${step.toolName}`);
    if (step.result?.data) {
      const data = step.result.data as Record<string, unknown>;
      console.log(`      标题: ${data.title || "(无)"}`);
      if (data._fallback) console.log("      (Fallback 模式)");
    }
    if (step.result?.error) {
      console.log(`      错误: ${step.result.error}`);
    }
  }

  // 检查 Memory 记录
  const messages = agent.memory.getRecentMessages(5);
  console.log(`\n  Memory 会话: ${messages.length} 条`);

  // Agent 状态
  const agentStatus = agent.getStatus();
  console.log(`  Agent 状态:`, agentStatus);

  const ok = task.steps.length > 0;
  console.log(ok ? "✅ 完整工作流正常" : "❌ 完整工作流异常");

  await agent.shutdown();
  return ok;
}

// ==================== Main ====================

async function main(): Promise<void> {
  console.log("🚀 Agent Core v2 — 端到端测试\n");
  console.log("=" .repeat(60));

  const results: boolean[] = [];

  results.push(await testSkillSystem());
  results.push(await testMemorySystem());
  results.push(await testIntentEngine());
  results.push(await testFullWorkflow());

  console.log("\n" + "=".repeat(60));
  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log(`\n📊 测试结果: ${passed}/${total} 通过`);

  if (passed === total) {
    console.log("🎉 全部通过！Agent Core v2 就绪。");
  } else {
    console.log("⚠️  部分测试失败，请检查。");
    process.exit(1);
  }
}

main().catch(console.error);
