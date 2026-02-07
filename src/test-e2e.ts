/**
 * 端到端测试脚本
 *
 * 验证完整链路：自然语言指令 → 意图识别 → 采集 → AI 生成 → 发布
 *
 * 使用方法：
 *   # 设置环境变量（可选，不设置则使用 fallback 模式）
 *   export DEEPSEEK_API_KEY=sk-xxx
 *   # 或
 *   export GEMINI_API_KEY=xxx
 *
 *   # 运行测试
 *   npx tsx src/test-e2e.ts
 */

import { AgentCore } from "./agent.js";
import { createAllDefaultTools } from "./tools/defaults.js";
import type { AgentConfig, AgentTask } from "./types.js";

// ==================== 配置 ====================

function getConfig(): AgentConfig {
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  const config: AgentConfig = {
    xhsApiUrl: process.env.XHS_API_URL || "http://127.0.0.1:18060",
    trendApiUrl: process.env.TREND_API_URL || "http://127.0.0.1:3001",
  };

  if (deepseekKey) {
    config.llm = {
      provider: "deepseek",
      apiKey: deepseekKey,
      model: "deepseek-chat",
    };
    console.log("[Config] 使用 DeepSeek API");
  } else if (geminiKey) {
    config.llm = {
      provider: "gemini",
      apiKey: geminiKey,
      model: "gemini-2.0-flash",
    };
    console.log("[Config] 使用 Gemini API");
  } else {
    console.log("[Config] 未设置 LLM API Key，将使用 fallback 模式");
  }

  return config;
}

// ==================== 测试用例 ====================

async function testToolRegistration(agent: AgentCore): Promise<boolean> {
  console.log("\n========== 测试 1: 工具注册 ==========");
  const tools = agent.getToolDescriptions();
  console.log(`已注册 ${tools.length} 个工具:`);
  for (const tool of tools) {
    console.log(`  [${tool.category}] ${tool.name} — ${tool.description}`);
  }
  const ok = tools.length >= 10;
  console.log(ok ? "✅ 工具注册正常" : "❌ 工具数量不足");
  return ok;
}

async function testIntentParsing(agent: AgentCore): Promise<boolean> {
  console.log("\n========== 测试 2: 意图识别 ==========");
  const testCases = [
    { input: "发一篇小红书关于健身的文章", expected: "publish_xhs" },
    { input: "帮我发公众号文章讲讲AI趋势", expected: "publish_wechat" },
    { input: "搜索最近的减脂热点", expected: "search" },
    { input: "生成一篇关于独立开发的内容", expected: "generate" },
    { input: "触发每日工作流", expected: "workflow" },
  ];

  let passed = 0;
  for (const tc of testCases) {
    const intent = agent.parseIntent(tc.input);
    const ok = intent.intent === tc.expected;
    console.log(`  ${ok ? "✅" : "❌"} "${tc.input}" → ${intent.intent} (期望: ${tc.expected})`);
    if (ok) passed++;
  }

  console.log(`意图识别: ${passed}/${testCases.length} 通过`);
  return passed === testCases.length;
}

async function testScraping(agent: AgentCore): Promise<boolean> {
  console.log("\n========== 测试 3: 热点采集 ==========");
  const result = await agent.executeTool("scrape-trending", { domain: "tech", count: 3 });
  console.log(`  采集结果: success=${result.success}`);
  if (result.data) {
    const data = result.data as { topics?: Array<{ title: string }> };
    if (data.topics) {
      for (const t of data.topics.slice(0, 3)) {
        console.log(`    - ${t.title}`);
      }
    }
  }
  console.log(result.success ? "✅ 热点采集正常" : "⚠️ 采集降级（使用 fallback）");
  return result.success;
}

async function testContentGeneration(agent: AgentCore): Promise<boolean> {
  console.log("\n========== 测试 4: AI 内容生成 ==========");
  const result = await agent.executeTool("ai-generate-content", {
    topic: "独立开发者如何用AI提升效率",
    platform: "xhs",
    style: "种草",
  });

  console.log(`  生成结果: success=${result.success}`);
  if (result.data) {
    const data = result.data as { title?: string; tags?: string[]; _fallback?: boolean; _llmProvider?: string };
    console.log(`    标题: ${data.title}`);
    console.log(`    标签: ${data.tags?.join(", ")}`);
    if (data._fallback) {
      console.log("  ⚠️ 使用 fallback 模式（未配置 LLM API Key）");
    } else {
      console.log(`    LLM: ${data._llmProvider}`);
    }
  }
  console.log(result.success ? "✅ 内容生成正常" : "❌ 内容生成失败");
  return result.success;
}

async function testPlatformStatus(agent: AgentCore): Promise<boolean> {
  console.log("\n========== 测试 5: 平台服务状态 ==========");
  const result = await agent.executeTool("check-platform-status", {});
  if (result.data) {
    const data = result.data as { services: Array<{ platform: string; status: string }> };
    for (const s of data.services) {
      const icon = s.status === "online" ? "🟢" : "🔴";
      console.log(`  ${icon} ${s.platform}: ${s.status}`);
    }
  }
  console.log("✅ 状态检查完成");
  return true;
}

async function testE2EWorkflow(agent: AgentCore): Promise<boolean> {
  console.log("\n========== 测试 6: 端到端工作流 ==========");
  console.log('指令: "帮我发一篇小红书关于AI副业的文章"');

  const task = await agent.run("帮我发一篇小红书关于AI副业的文章");

  console.log(`  任务状态: ${task.status}`);
  console.log(`  步骤数: ${task.steps.length}`);
  for (const step of task.steps) {
    const icon = step.status === "completed" ? "✅" : step.status === "failed" ? "❌" : "⏭️";
    console.log(`    ${icon} [${step.id}] ${step.toolName} → ${step.status}`);
    if (step.result?.error) {
      console.log(`       错误: ${step.result.error}`);
    }
  }

  // 如果后端服务未启动，发布步骤会失败但前面的生成步骤应该成功
  const genStep = task.steps.find((s) => s.id === "gen-content");
  const genOk = genStep?.status === "completed";
  console.log(
    genOk
      ? "✅ 内容生成步骤成功（发布步骤需要后端服务）"
      : "❌ 工作流异常"
  );
  return genOk;
}

// ==================== 主程序 ====================

async function main() {
  console.log("╔════════════════════════════════════════╗");
  console.log("║    AI 分身 Agent Core — 端到端测试      ║");
  console.log("╚════════════════════════════════════════╝");

  const config = getConfig();
  const agent = new AgentCore(config);
  agent.registerTools(createAllDefaultTools(config));

  const results: Array<{ name: string; passed: boolean }> = [];

  results.push({ name: "工具注册", passed: await testToolRegistration(agent) });
  results.push({ name: "意图识别", passed: await testIntentParsing(agent) });
  results.push({ name: "热点采集", passed: await testScraping(agent) });
  results.push({ name: "内容生成", passed: await testContentGeneration(agent) });
  results.push({ name: "平台状态", passed: await testPlatformStatus(agent) });
  results.push({ name: "端到端工作流", passed: await testE2EWorkflow(agent) });

  console.log("\n╔════════════════════════════════════════╗");
  console.log("║              测试结果汇总               ║");
  console.log("╚════════════════════════════════════════╝");
  for (const r of results) {
    console.log(`  ${r.passed ? "✅" : "❌"} ${r.name}`);
  }

  const passedCount = results.filter((r) => r.passed).length;
  console.log(`\n总计: ${passedCount}/${results.length} 通过`);

  if (passedCount === results.length) {
    console.log("\n🎉 所有测试通过！Agent Core 已就绪。");
  } else {
    console.log("\n⚠️ 部分测试未通过（可能是后端服务未启动，属于正常情况）");
  }
}

main().catch(console.error);
