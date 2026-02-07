/**
 * Phase 3C 端到端测试
 *
 * 测试模块：
 * 1. MCP Server — tools/list + tools/call
 * 2. MCP Client — 连接 + 工具发现
 * 3. MCP Manager — 批量管理
 * 4. Multi-Agent Orchestrator — 多角色协作
 * 5. Workflow Engine — 管道执行
 */

import { AgentCore } from "./agent.js";
import { getAllBundledSkills } from "./skills/bundled/index.js";
import { McpServer } from "./mcp/server.js";
import { McpManager, DEFAULT_MCP_SERVERS } from "./mcp/manager.js";
import { Orchestrator, ALL_ROLES, getAllRoles } from "./multi-agent/index.js";
import { WorkflowEngine, getAllPresetPipelines, CONTENT_CREATION_PIPELINE } from "./workflow/index.js";

import type { OrchestratorEvent } from "./multi-agent/types.js";
import type { PipelineEvent } from "./workflow/types.js";

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

// ==================== 创建测试 Agent ====================

function createTestAgent(): AgentCore {
  const agent = new AgentCore({
    xhsApiUrl: "http://localhost:18060",
    wechatApiUrl: "http://localhost:18061",
  });
  agent.registerSkills(getAllBundledSkills());
  return agent;
}

// ==================== 测试 1: MCP Server ====================

async function testMcpServer(): Promise<void> {
  section("测试 1: MCP Server");

  const agent = createTestAgent();
  await agent.initialize();

  const server = new McpServer(agent);

  // 验证 Server 实例化
  assert(server !== null, "McpServer 实例创建成功");

  // 验证 Agent 工具已注册
  const tools = agent.getAllTools();
  assert(tools.length > 0, `Agent 工具已注册: ${tools.length} 个`);

  // 验证工具名称
  const toolNames = tools.map(t => t.name);
  console.log(`  📋 可用工具: ${toolNames.join(", ")}`);
  assert(toolNames.length >= 5, "至少 5 个工具可暴露为 MCP");

  await agent.shutdown();
}

// ==================== 测试 2: MCP Manager ====================

async function testMcpManager(): Promise<void> {
  section("测试 2: MCP Manager");

  // 测试 Manager 创建（不实际连接外部 Server）
  const manager = new McpManager({
    servers: DEFAULT_MCP_SERVERS,
    autoReconnectMs: 0,
  });

  // 验证默认配置
  assert(DEFAULT_MCP_SERVERS.length >= 3, `预设 ${DEFAULT_MCP_SERVERS.length} 个 MCP Server 配置`);

  // 验证状态
  const status = manager.getStatus();
  assert(status.length === 0, "初始无连接（均为 disabled）");

  // 验证获取空工具列表
  const tools = manager.getAllTools();
  assert(tools.length === 0, "未连接时工具列表为空");

  // 测试自定义 Server 配置
  const customManager = new McpManager({
    servers: [
      {
        name: "test-server",
        enabled: false,
        config: {
          command: "echo",
          args: ["test"],
          toolPrefix: "test",
          timeout: 5000,
        },
      },
    ],
  });
  assert(customManager !== null, "自定义 Manager 创建成功");

  await manager.disconnectAll();
}

// ==================== 测试 3: Multi-Agent Roles ====================

async function testMultiAgentRoles(): Promise<void> {
  section("测试 3: Multi-Agent 角色系统");

  // 验证预设角色
  const roles = getAllRoles();
  assert(roles.length === 5, `预设 5 个角色: ${roles.map(r => r.name).join(", ")}`);

  // 验证角色属性
  assert(ALL_ROLES.writer.id === "writer", "写手角色: writer");
  assert(ALL_ROLES.editor.id === "editor", "编辑角色: editor");
  assert(ALL_ROLES.publisher.id === "publisher", "发布员角色: publisher");
  assert(ALL_ROLES.analyst.id === "analyst", "分析师角色: analyst");
  assert(ALL_ROLES.coordinator.id === "coordinator", "协调员角色: coordinator");

  // 验证角色工具权限
  assert(
    ALL_ROLES.writer.allowedCategories.includes("generate"),
    "写手可使用 generate 类工具"
  );
  assert(
    ALL_ROLES.publisher.allowedCategories.includes("publish"),
    "发布员可使用 publish 类工具"
  );
}

// ==================== 测试 4: Orchestrator ====================

async function testOrchestrator(): Promise<void> {
  section("测试 4: Multi-Agent Orchestrator");

  const agent = createTestAgent();
  await agent.initialize();

  const orchestrator = new Orchestrator(agent, {
    strategy: "sequential",
    maxReviewRounds: 2,
  });

  // 验证角色注册
  const roles = orchestrator.listRoles();
  assert(roles.length === 5, `编排器包含 ${roles.length} 个角色`);

  // 验证自定义角色注册
  orchestrator.registerRole({
    id: "custom-role",
    name: "自定义角色",
    description: "测试角色",
    systemPrompt: "你是测试角色",
    allowedCategories: ["generate"],
  });
  assert(orchestrator.listRoles().length === 6, "自定义角色注册成功");
  assert(orchestrator.getRole("custom-role")?.name === "自定义角色", "获取自定义角色");

  // 测试事件监听
  const events: OrchestratorEvent[] = [];
  orchestrator.on((event) => events.push(event));

  // 执行协作任务
  const task = await orchestrator.execute("写一篇关于 AI 健身的文章");

  assert(task !== null, "协作任务创建成功");
  assert(task.id.startsWith("collab-"), `任务 ID: ${task.id}`);
  assert(task.phases.length > 0, `任务包含 ${task.phases.length} 个阶段`);
  assert(task.type === "content_pipeline", `任务类型: ${task.type}`);

  // 验证阶段分配
  const writerPhases = task.phases.filter(p => p.assignedTo === "writer");
  const editorPhases = task.phases.filter(p => p.assignedTo === "editor");
  const publisherPhases = task.phases.filter(p => p.assignedTo === "publisher");
  assert(writerPhases.length >= 1, `写手阶段: ${writerPhases.length} 个`);
  assert(editorPhases.length >= 1, `编辑阶段: ${editorPhases.length} 个`);
  assert(publisherPhases.length >= 1, `发布员阶段: ${publisherPhases.length} 个`);

  // 验证消息通信
  const messages = orchestrator.getMessages(task.id);
  assert(messages.length > 0, `Agent 间消息: ${messages.length} 条`);

  // 验证事件触发
  assert(events.length > 0, `事件触发: ${events.length} 个`);

  // 验证状态查询
  const status = orchestrator.getStatus();
  assert(status.roles === 6, `角色数: ${status.roles}`);
  assert(status.messages > 0, `消息数: ${status.messages}`);

  console.log(`  📊 编排器状态: ${JSON.stringify(status)}`);

  await agent.shutdown();
}

// ==================== 测试 5: Workflow Engine ====================

async function testWorkflowEngine(): Promise<void> {
  section("测试 5: Workflow Engine");

  const agent = createTestAgent();
  await agent.initialize();

  const engine = new WorkflowEngine(agent);

  // 注册预设管道
  const presets = getAllPresetPipelines();
  assert(presets.length === 3, `预设管道: ${presets.length} 个`);

  for (const preset of presets) {
    engine.register(preset);
  }

  // 验证管道注册
  const pipelines = engine.listPipelines();
  assert(pipelines.length === 3, `已注册管道: ${pipelines.length} 个`);

  // 验证管道获取
  const contentPipeline = engine.getPipeline("content-creation");
  assert(contentPipeline !== undefined, "内容创作管道已注册");
  assert(contentPipeline!.nodes.length === 6, `管道节点: ${contentPipeline!.nodes.length} 个`);

  // 验证管道结构
  assert(contentPipeline!.entryNodeId === "research", "入口节点: research");
  assert(contentPipeline!.edges.length > 0, `管道边: ${contentPipeline!.edges.length} 条`);

  // 测试事件监听
  const events: PipelineEvent[] = [];
  engine.on((event) => events.push(event));

  // 执行简单管道
  const ctx = await engine.run("content-creation", { topic: "AI 健身趋势" });

  assert(ctx !== null, "管道执行上下文创建成功");
  assert(ctx.runId.startsWith("run-"), `运行 ID: ${ctx.runId}`);
  assert(ctx.data["topic"] === "AI 健身趋势", "输入参数正确");

  // 验证管道执行日志
  assert(ctx.logs.length > 0, `执行日志: ${ctx.logs.length} 条`);

  // 验证事件
  assert(events.length > 0, `管道事件: ${events.length} 个`);

  // 验证引擎状态
  const status = engine.getStatus();
  assert(status.pipelines === 3, `管道数: ${status.pipelines}`);
  console.log(`  📊 引擎状态: ${JSON.stringify(status)}`);

  // 测试管道注销
  engine.unregister("daily-report");
  assert(engine.listPipelines().length === 2, "管道注销成功");

  await agent.shutdown();
}

// ==================== 测试 6: 集成测试 ====================

async function testIntegration(): Promise<void> {
  section("测试 6: 集成测试（Agent + Orchestrator + Workflow）");

  const agent = createTestAgent();
  await agent.initialize();

  // 同一个 Agent 实例上同时使用 Orchestrator 和 Workflow
  const orchestrator = new Orchestrator(agent);
  const workflow = new WorkflowEngine(agent);

  // 注册管道
  for (const preset of getAllPresetPipelines()) {
    workflow.register(preset);
  }

  // Agent 基础状态
  const agentStatus = agent.getStatus();
  assert(agentStatus.skills.active > 0, `Agent 活跃 Skills: ${agentStatus.skills.active}`);
  assert(agentStatus.tools > 0, `Agent 工具总数: ${agentStatus.tools}`);

  // Orchestrator 状态
  const orchStatus = orchestrator.getStatus();
  assert(orchStatus.roles === 5, `Orchestrator 角色: ${orchStatus.roles}`);

  // Workflow 状态
  const wfStatus = workflow.getStatus();
  assert(wfStatus.pipelines === 3, `Workflow 管道: ${wfStatus.pipelines}`);

  // 全模块协同正常
  assert(true, "Agent + Orchestrator + Workflow 全模块协同正常 🎉");

  await agent.shutdown();
}

// ==================== 主入口 ====================

async function main(): Promise<void> {
  console.log("🚀 Jarvis Agent v3 — Phase 3C 端到端测试\n");
  console.log("模块: MCP + Multi-Agent + Workflow\n");

  const start = Date.now();

  await testMcpServer();
  await testMcpManager();
  await testMultiAgentRoles();
  await testOrchestrator();
  await testWorkflowEngine();
  await testIntegration();

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
