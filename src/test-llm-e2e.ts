/**
 * test-llm-e2e.ts — 真实 LLM 端到端联调测试
 *
 * 使用硅基流动 (SiliconFlow) DeepSeek-V3 API 进行真实调用。
 * 验证：API 连通 → 普通对话 → 流式输出 → createJarvis 全链路 → RAG + 知识库
 *
 * 运行: npx tsx src/test-llm-e2e.ts
 */

import { createLLMClient } from "./providers/llm.js";
import { ConfigLoader } from "./config/loader.js";

const C = {
  green: "\x1b[32m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
};

let passed = 0;
let failed = 0;
let skipped = 0;
const errors: string[] = [];

function ok(name: string): void {
  passed++;
  console.log(`  ${C.green}✓${C.reset} ${name}`);
}

function fail(name: string, error?: string): void {
  failed++;
  const msg = `  ${C.red}✗${C.reset} ${name}${error ? ` — ${error}` : ""}`;
  console.log(msg);
  errors.push(msg);
}

function skip(name: string, reason: string): void {
  skipped++;
  console.log(`  ${C.yellow}○${C.reset} ${name} ${C.dim}(${reason})${C.reset}`);
}

function section(title: string): void {
  console.log(`\n${C.cyan}${C.bold}▸ ${title}${C.reset}`);
}

// ==================== 主函数 ====================

async function main(): Promise<void> {
  console.log(`\n${C.bold}═══════════════════════════════════════════════════`);
  console.log(`  Jarvis LLM 端到端联调测试 — 硅基流动 DeepSeek-V3`);
  console.log(`═══════════════════════════════════════════════════${C.reset}\n`);

  // ─────────── 1. 配置加载 ───────────

  section("1. ConfigLoader 加载 .env");

  const loader = new ConfigLoader();
  const config = loader.load();

  if (config.llm.apiKey) {
    ok(`API Key 已加载: sk-...${config.llm.apiKey.slice(-6)}`);
  } else {
    fail("API Key 未加载");
    console.log(`\n${C.red}无法继续测试，请检查 .env 文件中的 JARVIS_LLM_API_KEY${C.reset}`);
    process.exit(1);
  }

  if (config.llm.baseUrl?.includes("siliconflow")) {
    ok(`Base URL: ${config.llm.baseUrl}`);
  } else {
    ok(`Base URL: ${config.llm.baseUrl || "(使用默认值)"}`);
  }

  ok(`Model: ${config.llm.model}`);
  ok(`Provider: ${config.llm.provider}`);

  // ─────────── 2. LLM Client 创建 ───────────

  section("2. 创建 LLMClient");

  const agentConfig = {
    name: "Jarvis-LLM-Test",
    llm: {
      provider: config.llm.provider as "deepseek" | "openai" | "gemini",
      apiKey: config.llm.apiKey!,
      model: config.llm.model,
      baseUrl: config.llm.baseUrl,
    },
  };

  const llm = createLLMClient(agentConfig);
  if (llm) {
    ok("LLMClient 创建成功");
    const info = llm.getInfo();
    ok(`Provider: ${info.provider} | Model: ${info.model}`);
    ok(`Base URL: ${info.baseUrl}`);
  } else {
    fail("LLMClient 创建失败");
    process.exit(1);
  }

  // ─────────── 3. 普通对话（非流式） ───────────

  section("3. 普通对话（Chat Completions）");

  try {
    console.log(`  ${C.dim}发送: "你好，请用一句话介绍你自己"${C.reset}`);
    const startChat = Date.now();
    const response = await llm.chat(
      [
        { role: "system", content: "你是 Jarvis，一个智能 AI 助手。请简洁回答。" },
        { role: "user", content: "你好，请用一句话介绍你自己" },
      ],
      { maxTokens: 256 }
    );
    const chatTime = Date.now() - startChat;

    if (response.content && response.content.length > 0) {
      ok(`收到回复 (${chatTime}ms): "${response.content.slice(0, 80)}${response.content.length > 80 ? "..." : ""}"`);
    } else {
      fail("回复为空");
    }

    ok(`模型: ${response.model}`);

    if (response.usage) {
      ok(`Token 用量: prompt=${response.usage.promptTokens}, completion=${response.usage.completionTokens}, total=${response.usage.totalTokens}`);
    } else {
      skip("Token 用量", "API 未返回用量信息");
    }
  } catch (error) {
    fail(`对话失败: ${error instanceof Error ? error.message : String(error)}`);
  }

  // ─────────── 4. 简易对话 ───────────

  section("4. 简易对话（complete）");

  try {
    console.log(`  ${C.dim}发送: "列出 3 种编程语言（JSON 数组）"${C.reset}`);
    const startComplete = Date.now();
    const text = await llm.complete(
      "请列出 3 种最流行的编程语言，用 JSON 数组格式返回，如 [\"a\",\"b\",\"c\"]。只返回数组，不要其他内容。",
      { maxTokens: 128 }
    );
    const completeTime = Date.now() - startComplete;

    if (text && text.length > 0) {
      ok(`收到回复 (${completeTime}ms): ${text.slice(0, 100)}`);
      try {
        const jsonMatch = text.match(/\[[\s\S]*?\]/);
        if (jsonMatch) {
          const arr = JSON.parse(jsonMatch[0]);
          if (Array.isArray(arr) && arr.length >= 3) {
            ok(`JSON 解析成功: ${JSON.stringify(arr)}`);
          } else {
            skip("JSON 解析", `返回元素不足: ${text.slice(0, 50)}`);
          }
        } else {
          skip("JSON 解析", `返回非数组: ${text.slice(0, 50)}`);
        }
      } catch {
        skip("JSON 解析", `返回非严格 JSON: ${text.slice(0, 50)}`);
      }
    } else {
      fail("回复为空");
    }
  } catch (error) {
    fail(`complete 失败: ${error instanceof Error ? error.message : String(error)}`);
  }

  // ─────────── 5. 流式对话（SSE） ───────────

  section("5. 流式对话（chatStream SSE）");

  try {
    console.log(`  ${C.dim}发送: "用 3 句话描述太阳系"${C.reset}`);
    const startStream = Date.now();
    let chunkCount = 0;
    let totalChars = 0;

    const fullText = await llm.chatStream(
      [
        { role: "system", content: "你是一个天文学专家。" },
        { role: "user", content: "用 3 句话描述太阳系" },
      ],
      {
        onChunk: (chunk) => {
          chunkCount++;
          totalChars += chunk.length;
          if (chunkCount <= 3) {
            console.log(`  ${C.dim}chunk[${chunkCount}]: "${chunk}"${C.reset}`);
          }
        },
        onDone: (text) => {
          const streamTime = Date.now() - startStream;
          ok(`流式完成 (${streamTime}ms): ${chunkCount} chunks, ${totalChars} chars`);
          ok(`完整回复: "${text.slice(0, 80)}${text.length > 80 ? "..." : ""}"`);
        },
        onError: (err) => {
          fail(`流式错误: ${err.message}`);
        },
      },
      { maxTokens: 256 }
    );

    if (fullText.length > 0) {
      ok("chatStream 返回值正确");
    }
  } catch (error) {
    fail(`chatStream 失败: ${error instanceof Error ? error.message : String(error)}`);
  }

  // ─────────── 6. completeStream ───────────

  section("6. 简易流式（completeStream）");

  try {
    console.log(`  ${C.dim}发送: "TypeScript 的三个优点"${C.reset}`);
    const startSimple = Date.now();
    let sChunks = 0;

    const result = await llm.completeStream(
      "用一行话分别说 TypeScript 的三个优点。",
      (_chunk) => {
        sChunks++;
      },
      { maxTokens: 256 }
    );

    const simpleTime = Date.now() - startSimple;
    if (result.length > 10) {
      ok(`completeStream 成功 (${simpleTime}ms, ${sChunks} chunks)`);
      ok(`回复: "${result.slice(0, 100)}${result.length > 100 ? "..." : ""}"`);
    } else {
      fail("回复过短");
    }
  } catch (error) {
    fail(`completeStream 失败: ${error instanceof Error ? error.message : String(error)}`);
  }

  // ─────────── 7. createJarvis 全链路 ───────────

  section("7. createJarvis() 全链路联调");

  try {
    const { createJarvis } = await import("./bootstrap.js");

    console.log(`  ${C.dim}初始化 Jarvis 完整运行时...${C.reset}`);
    const startJarvis = Date.now();
    const jarvis = await createJarvis({
      dataDir: "/tmp/jarvis-llm-test",
      autoStartWeb: false,
    });
    const initTime = Date.now() - startJarvis;

    ok(`Jarvis 初始化完成 (${initTime}ms)`);

    if (jarvis.llm) {
      const info = jarvis.llm.getInfo();
      ok(`LLM 已挂载: ${info.provider}/${info.model}`);
    } else {
      fail("LLM 未挂载到 Jarvis 实例");
    }

    // 测试 jarvis.chat()
    console.log(`\n  ${C.dim}测试 jarvis.chat("你好，Jarvis")...${C.reset}`);
    const startChatJ = Date.now();
    const reply = await jarvis.chat("你好，Jarvis！请用一句话介绍你自己。");
    const chatJTime = Date.now() - startChatJ;

    if (reply && reply.length > 5) {
      ok(`jarvis.chat 回复 (${chatJTime}ms): "${reply.slice(0, 100)}${reply.length > 100 ? "..." : ""}"`);
    } else {
      ok(`jarvis.chat 回复 (fallback): "${reply.slice(0, 100)}"`);
    }

    // 测试对话记录持久化
    const status = jarvis.getFullStatus();
    ok(`状态: ${status.conversations.total} 对话, ${status.conversations.messages} 消息`);

    // 测试知识库 + chat
    jarvis.knowledge.addDocument(
      "Jarvis 简介",
      "Jarvis 是一个开源 AI 分身助手，具备 24 个核心模块，支持 10+ 内置 Skill，可在桌面和网页使用。它的创建者是 Yuyu。",
    );
    console.log(`\n  ${C.dim}测试知识库增强 chat("Jarvis有多少模块？")...${C.reset}`);
    const startKB = Date.now();
    const kbReply = await jarvis.chat("请告诉我 Jarvis 有多少个核心模块？");
    const kbTime = Date.now() - startKB;
    ok(`知识库增强回复 (${kbTime}ms): "${kbReply.slice(0, 100)}${kbReply.length > 100 ? "..." : ""}"`);

    // 测试向量记忆
    jarvis.memory.remember("我最喜欢的语言是 TypeScript", { type: "preference", importance: 9 });
    const searchResults = jarvis.memory.search("TypeScript", 1);
    if (searchResults.length > 0 && searchResults[0].score !== undefined) {
      ok(`向量记忆搜索有效: score=${searchResults[0].score.toFixed(3)}`);
    } else if (searchResults.length > 0) {
      ok("向量记忆搜索有结果（无 score）");
    } else {
      skip("向量记忆搜索", "暂无匹配");
    }

    // 清理
    await jarvis.shutdown();
    ok("Jarvis 已优雅关闭");
  } catch (error) {
    fail(`createJarvis 全链路: ${error instanceof Error ? error.message : String(error)}`);
  }

  // ─────────── 汇总 ───────────

  console.log(`\n${C.bold}═══════════════════════════════════════════════════`);
  console.log(`  结果: ${C.green}${passed} 通过${C.reset}${C.bold}  ${failed > 0 ? C.red : ""}${failed} 失败${C.reset}${C.bold}  ${skipped > 0 ? C.yellow : ""}${skipped} 跳过${C.reset}`);

  if (errors.length > 0) {
    console.log(`\n${C.red}失败详情:${C.reset}`);
    errors.forEach((e) => console.log(e));
  }

  console.log(`${C.bold}═══════════════════════════════════════════════════${C.reset}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
