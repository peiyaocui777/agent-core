/**
 * Web Dashboard — 轻量级内置 HTTP API + 静态页面
 *
 * 提供 Agent 管理界面的后端 API：
 * - GET  /api/status          — Agent 状态概览
 * - GET  /api/skills          — Skill 列表
 * - POST /api/skills/:name/toggle — 启用/禁用 Skill
 * - GET  /api/tools           — 工具列表
 * - GET  /api/tasks           — 任务历史
 * - GET  /api/memory          — 记忆摘要
 * - GET  /api/marketplace     — Marketplace 搜索
 * - POST /api/marketplace/install — 安装 Skill
 * - GET  /api/workflow/pipelines — 管道列表
 * - GET  /api/orchestrator    — 编排器状态
 * - GET  /                    — Dashboard HTML 页面
 *
 * 零依赖：仅使用 Node.js 内置 http 模块
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import type { AgentCore } from "../agent.js";
import type { SkillRegistry } from "../marketplace/registry.js";
import type { Orchestrator } from "../multi-agent/orchestrator.js";
import type { WorkflowEngine } from "../workflow/engine.js";

export interface DashboardConfig {
  port: number;
  host?: string;
}

export class DashboardServer {
  private agent: AgentCore;
  private registry?: SkillRegistry;
  private orchestrator?: Orchestrator;
  private workflow?: WorkflowEngine;
  private config: DashboardConfig;
  private server?: ReturnType<typeof createServer>;

  constructor(
    agent: AgentCore,
    config?: Partial<DashboardConfig>,
    options?: {
      registry?: SkillRegistry;
      orchestrator?: Orchestrator;
      workflow?: WorkflowEngine;
    },
  ) {
    this.agent = agent;
    this.config = { port: 3800, host: "127.0.0.1", ...config };
    this.registry = options?.registry;
    this.orchestrator = options?.orchestrator;
    this.workflow = options?.workflow;
  }

  /** 启动 Dashboard 服务器 */
  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      this.handleRequest(req, res).catch((err) => {
        console.error("[Dashboard] 请求处理异常:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal Server Error" }));
      });
    });

    return new Promise((resolve) => {
      this.server!.listen(this.config.port, this.config.host, () => {
        console.log(
          `[Dashboard] 已启动: http://${this.config.host}:${this.config.port}`
        );
        resolve();
      });
    });
  }

  /** 停止服务器 */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  // ==================== 路由分发 ====================

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const path = url.pathname;

    // API 路由
    if (path === "/api/status") return this.apiStatus(res);
    if (path === "/api/skills") return this.apiSkills(res);
    if (path.startsWith("/api/skills/") && path.endsWith("/toggle") && req.method === "POST")
      return this.apiToggleSkill(path, res);
    if (path === "/api/tools") return this.apiTools(res);
    if (path === "/api/tasks") return this.apiTasks(res);
    if (path === "/api/memory") return this.apiMemory(res);
    if (path === "/api/marketplace") return this.apiMarketplace(url, res);
    if (path === "/api/marketplace/install" && req.method === "POST")
      return this.apiInstall(req, res);
    if (path === "/api/workflow/pipelines") return this.apiPipelines(res);
    if (path === "/api/orchestrator") return this.apiOrchestrator(res);

    // 首页
    if (path === "/" || path === "/index.html") return this.serveDashboard(res);

    // 404
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not Found" }));
  }

  // ==================== API 实现 ====================

  private apiStatus(res: ServerResponse): void {
    const status = this.agent.getStatus();
    const extra: Record<string, unknown> = {};

    if (this.orchestrator) extra.orchestrator = this.orchestrator.getStatus();
    if (this.workflow) extra.workflow = this.workflow.getStatus();
    if (this.registry) extra.marketplace = this.registry.getStats();

    this.json(res, { ...status, ...extra, version: "3.0.0", uptime: process.uptime() });
  }

  private apiSkills(res: ServerResponse): void {
    this.json(res, this.agent.skills.getStatus());
  }

  private async apiToggleSkill(path: string, res: ServerResponse): Promise<void> {
    const match = path.match(/^\/api\/skills\/(.+)\/toggle$/);
    if (!match) return this.json(res, { error: "Invalid path" }, 400);

    const name = decodeURIComponent(match[1]);
    const skills = this.agent.skills;

    // 查找 Skill
    const allSkills = skills.getStatus();
    const skill = allSkills.find((s) => s.name === name);
    if (!skill) return this.json(res, { error: "Skill not found" }, 404);

    let success: boolean;
    if (skill.active) {
      success = await skills.deactivateSkill(name);
    } else {
      success = await skills.activateSkill(name);
    }

    this.json(res, { success, name, active: !skill.active });
  }

  private apiTools(res: ServerResponse): void {
    const tools = this.agent.getAllTools().map((t) => ({
      name: t.name,
      description: t.description,
      category: t.category,
      parameterCount: Object.keys(t.parameters).length,
      parameters: Object.entries(t.parameters).map(([k, v]) => ({
        name: k,
        ...v,
      })),
    }));
    this.json(res, tools);
  }

  private apiTasks(res: ServerResponse): void {
    const tasks = this.agent.getTaskHistory().map((t) => ({
      id: t.id,
      instruction: t.userInstruction,
      status: t.status,
      stepCount: t.steps.length,
      steps: t.steps.map((s) => ({
        id: s.id,
        tool: s.toolName,
        status: s.status,
        success: s.result?.success,
      })),
      createdAt: t.createdAt,
      completedAt: t.completedAt,
    }));
    this.json(res, tasks);
  }

  private apiMemory(res: ServerResponse): void {
    const data = this.agent.memory.exportData();
    const recentMessages = this.agent.memory.getRecentMessages(10);
    this.json(res, {
      messages: recentMessages.length,
      recentMessages,
      memories: data.memories?.length || 0,
      publishHistory: data.publishHistory?.length || 0,
      recentPublish: (data.publishHistory || []).slice(-5),
      profile: data.profile || {},
    });
  }

  private apiMarketplace(url: URL, res: ServerResponse): void {
    if (!this.registry) {
      return this.json(res, { error: "Marketplace 未启用" }, 503);
    }

    const result = this.registry.search({
      query: url.searchParams.get("q") || undefined,
      category: url.searchParams.get("category") as any || undefined,
      sortBy: url.searchParams.get("sort") as any || "downloads",
      page: parseInt(url.searchParams.get("page") || "1"),
      pageSize: parseInt(url.searchParams.get("pageSize") || "20"),
    });
    this.json(res, result);
  }

  private async apiInstall(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.registry) {
      return this.json(res, { error: "Marketplace 未启用" }, 503);
    }

    const body = await this.readBody(req);
    const { packageName } = JSON.parse(body);

    if (!packageName) {
      return this.json(res, { error: "缺少 packageName" }, 400);
    }

    const result = await this.registry.install(packageName);
    this.json(res, result);
  }

  private apiPipelines(res: ServerResponse): void {
    if (!this.workflow) {
      return this.json(res, { error: "Workflow 未启用" }, 503);
    }

    const pipelines = this.workflow.listPipelines().map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      version: p.version,
      nodeCount: p.nodes.length,
      edgeCount: p.edges.length,
    }));
    this.json(res, pipelines);
  }

  private apiOrchestrator(res: ServerResponse): void {
    if (!this.orchestrator) {
      return this.json(res, { error: "Orchestrator 未启用" }, 503);
    }
    this.json(res, this.orchestrator.getStatus());
  }

  // ==================== Dashboard HTML ====================

  private serveDashboard(res: ServerResponse): void {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(this.generateDashboardHTML());
  }

  private generateDashboardHTML(): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Jarvis Agent Dashboard</title>
  <style>
    :root {
      --bg: #0f172a; --surface: #1e293b; --border: #334155;
      --text: #e2e8f0; --text-dim: #94a3b8; --accent: #3b82f6;
      --green: #22c55e; --red: #ef4444; --yellow: #eab308; --purple: #a855f7;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }

    .header { background: var(--surface); border-bottom: 1px solid var(--border); padding: 1rem 2rem; display: flex; align-items: center; gap: 1rem; }
    .header h1 { font-size: 1.5rem; font-weight: 700; }
    .header .version { background: var(--accent); color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; }
    .header .status-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--green); animation: pulse 2s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }

    .container { max-width: 1400px; margin: 0 auto; padding: 2rem; }

    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem; margin-bottom: 2rem; }
    .stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 1.5rem; }
    .stat-card .label { color: var(--text-dim); font-size: 0.875rem; margin-bottom: 0.5rem; }
    .stat-card .value { font-size: 2rem; font-weight: 700; }
    .stat-card .sub { color: var(--text-dim); font-size: 0.75rem; margin-top: 0.25rem; }

    .card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; }
    .card h2 { font-size: 1.125rem; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem; }
    .card h2 .icon { font-size: 1.25rem; }

    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; padding: 0.75rem; color: var(--text-dim); font-weight: 500; font-size: 0.8rem; text-transform: uppercase; border-bottom: 1px solid var(--border); }
    td { padding: 0.75rem; border-bottom: 1px solid var(--border); font-size: 0.875rem; }
    tr:hover { background: rgba(59,130,246,0.05); }

    .badge { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 0.7rem; font-weight: 600; }
    .badge-green { background: rgba(34,197,94,0.15); color: var(--green); }
    .badge-red { background: rgba(239,68,68,0.15); color: var(--red); }
    .badge-blue { background: rgba(59,130,246,0.15); color: var(--accent); }
    .badge-purple { background: rgba(168,85,247,0.15); color: var(--purple); }
    .badge-yellow { background: rgba(234,179,8,0.15); color: var(--yellow); }

    .btn { background: var(--accent); color: white; border: none; padding: 6px 16px; border-radius: 6px; cursor: pointer; font-size: 0.8rem; transition: opacity 0.2s; }
    .btn:hover { opacity: 0.85; }
    .btn-sm { padding: 3px 10px; font-size: 0.7rem; }
    .btn-outline { background: transparent; border: 1px solid var(--border); color: var(--text); }

    .tabs { display: flex; gap: 0.25rem; margin-bottom: 1.5rem; }
    .tab { padding: 8px 20px; border-radius: 8px; cursor: pointer; font-size: 0.875rem; color: var(--text-dim); transition: all 0.2s; }
    .tab:hover { background: var(--surface); }
    .tab.active { background: var(--accent); color: white; }

    .loading { text-align: center; padding: 2rem; color: var(--text-dim); }
    .empty { text-align: center; padding: 2rem; color: var(--text-dim); font-style: italic; }

    .tool-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 1rem; }
    .tool-item { background: rgba(59,130,246,0.05); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; }
    .tool-item .name { font-weight: 600; font-size: 0.875rem; margin-bottom: 0.25rem; }
    .tool-item .desc { color: var(--text-dim); font-size: 0.75rem; }

    .refresh-btn { position: fixed; bottom: 2rem; right: 2rem; width: 48px; height: 48px; border-radius: 50%; background: var(--accent); color: white; border: none; cursor: pointer; font-size: 1.25rem; box-shadow: 0 4px 12px rgba(0,0,0,0.3); transition: transform 0.2s; }
    .refresh-btn:hover { transform: scale(1.1); }
  </style>
</head>
<body>
  <div class="header">
    <div class="status-dot"></div>
    <h1>Jarvis Agent</h1>
    <span class="version">v3.0</span>
    <span style="flex:1"></span>
    <span id="uptime" style="color:var(--text-dim);font-size:0.8rem;"></span>
  </div>

  <div class="container">
    <!-- 统计卡片 -->
    <div class="grid" id="stats"></div>

    <!-- 标签页 -->
    <div class="tabs">
      <div class="tab active" data-tab="skills">Skills</div>
      <div class="tab" data-tab="tools">Tools</div>
      <div class="tab" data-tab="tasks">Tasks</div>
      <div class="tab" data-tab="memory">Memory</div>
      <div class="tab" data-tab="marketplace">Marketplace</div>
      <div class="tab" data-tab="workflow">Workflow</div>
    </div>

    <!-- 内容区 -->
    <div id="content"></div>
  </div>

  <button class="refresh-btn" onclick="loadAll()" title="刷新">&#x21bb;</button>

  <script>
    const API = '';
    let currentTab = 'skills';
    let data = {};

    // Tab 切换
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentTab = tab.dataset.tab;
        renderContent();
      });
    });

    async function fetchJSON(path) {
      try { const r = await fetch(API + path); return await r.json(); }
      catch { return null; }
    }

    async function loadAll() {
      const [status, skills, tools, tasks, memory, marketplace, pipelines] = await Promise.all([
        fetchJSON('/api/status'),
        fetchJSON('/api/skills'),
        fetchJSON('/api/tools'),
        fetchJSON('/api/tasks'),
        fetchJSON('/api/memory'),
        fetchJSON('/api/marketplace'),
        fetchJSON('/api/workflow/pipelines'),
      ]);
      data = { status, skills, tools, tasks, memory, marketplace, pipelines };
      renderStats();
      renderContent();
    }

    function renderStats() {
      const s = data.status;
      if (!s) return;
      document.getElementById('uptime').textContent = 'Uptime: ' + Math.floor(s.uptime) + 's';
      document.getElementById('stats').innerHTML = [
        statCard('Skills', s.skills?.active + '/' + s.skills?.total, '已激活 / 已加载'),
        statCard('Tools', s.tools, '可用工具'),
        statCard('Memory', s.memory?.memories + ' 条', s.memory?.publishHistory + ' 条发布记录'),
        statCard('Tasks', s.tasks, '历史任务'),
      ].join('');
    }

    function statCard(label, value, sub) {
      return '<div class="stat-card"><div class="label">' + label + '</div><div class="value">' + value + '</div><div class="sub">' + sub + '</div></div>';
    }

    function renderContent() {
      const el = document.getElementById('content');
      switch(currentTab) {
        case 'skills': el.innerHTML = renderSkills(); break;
        case 'tools': el.innerHTML = renderTools(); break;
        case 'tasks': el.innerHTML = renderTasks(); break;
        case 'memory': el.innerHTML = renderMemory(); break;
        case 'marketplace': el.innerHTML = renderMarketplace(); break;
        case 'workflow': el.innerHTML = renderWorkflow(); break;
      }
    }

    function renderSkills() {
      const skills = data.skills || [];
      if (!skills.length) return '<div class="empty">暂无 Skill</div>';
      const rows = skills.map(s =>
        '<tr><td><strong>' + s.name + '</strong></td><td>' + s.description + '</td>' +
        '<td><span class="badge badge-blue">' + s.category + '</span></td>' +
        '<td>' + s.toolCount + '</td>' +
        '<td><span class="badge ' + (s.active ? 'badge-green' : 'badge-red') + '">' + (s.active ? '活跃' : '停用') + '</span></td>' +
        '<td><span class="badge badge-purple">' + s.source + '</span></td></tr>'
      ).join('');
      return '<div class="card"><h2><span class="icon">⚡</span>Skills 列表</h2><table><thead><tr><th>名称</th><th>描述</th><th>分类</th><th>工具数</th><th>状态</th><th>来源</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    }

    function renderTools() {
      const tools = data.tools || [];
      if (!tools.length) return '<div class="empty">暂无工具</div>';
      const items = tools.map(t =>
        '<div class="tool-item"><div class="name">' + t.name + '</div><div class="desc">' + t.description + '</div>' +
        '<div style="margin-top:0.5rem"><span class="badge badge-blue">' + t.category + '</span> <span class="badge badge-yellow">' + t.parameterCount + ' 参数</span></div></div>'
      ).join('');
      return '<div class="card"><h2><span class="icon">🔧</span>工具列表 (' + tools.length + ')</h2><div class="tool-grid">' + items + '</div></div>';
    }

    function renderTasks() {
      const tasks = data.tasks || [];
      if (!tasks.length) return '<div class="empty">暂无任务历史</div>';
      const rows = tasks.map(t => {
        const statusBadge = t.status === 'completed' ? 'badge-green' : t.status === 'failed' ? 'badge-red' : 'badge-yellow';
        return '<tr><td><code>' + t.id + '</code></td><td>' + (t.instruction || '').substring(0, 50) + '</td>' +
          '<td><span class="badge ' + statusBadge + '">' + t.status + '</span></td>' +
          '<td>' + t.stepCount + '</td><td>' + new Date(t.createdAt).toLocaleString() + '</td></tr>';
      }).join('');
      return '<div class="card"><h2><span class="icon">📋</span>任务历史</h2><table><thead><tr><th>ID</th><th>指令</th><th>状态</th><th>步骤</th><th>时间</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    }

    function renderMemory() {
      const m = data.memory;
      if (!m) return '<div class="empty">暂无记忆数据</div>';
      let html = '<div class="card"><h2><span class="icon">🧠</span>记忆系统</h2>';
      html += '<p style="margin-bottom:1rem;color:var(--text-dim)">消息: ' + m.messages + ' 条 | 记忆: ' + m.memories + ' 条 | 发布: ' + m.publishHistory + ' 条</p>';
      if (m.recentMessages?.length) {
        html += '<h3 style="font-size:0.875rem;margin-bottom:0.5rem">最近消息</h3><table><thead><tr><th>角色</th><th>内容</th></tr></thead><tbody>';
        html += m.recentMessages.map(msg => '<tr><td><span class="badge ' + (msg.role === 'user' ? 'badge-blue' : 'badge-green') + '">' + msg.role + '</span></td><td>' + (msg.content || '').substring(0, 80) + '</td></tr>').join('');
        html += '</tbody></table>';
      }
      html += '</div>';
      return html;
    }

    function renderMarketplace() {
      const mp = data.marketplace;
      if (!mp || !mp.packages) return '<div class="empty">Marketplace 未启用或暂无数据</div>';
      const rows = mp.packages.map(p =>
        '<tr><td><strong>' + p.displayName + '</strong><div style="font-size:0.7rem;color:var(--text-dim)">' + p.name + '</div></td>' +
        '<td>' + p.description + '</td>' +
        '<td><span class="badge badge-blue">' + p.category + '</span></td>' +
        '<td>⭐ ' + p.rating.average + ' (' + p.rating.count + ')</td>' +
        '<td>' + p.downloads.total.toLocaleString() + '</td>' +
        '<td><button class="btn btn-sm" onclick="installPkg(\\'' + p.name + '\\')">安装</button></td></tr>'
      ).join('');
      return '<div class="card"><h2><span class="icon">🏪</span>Skills Marketplace (' + mp.total + ')</h2><table><thead><tr><th>名称</th><th>描述</th><th>分类</th><th>评分</th><th>下载量</th><th>操作</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    }

    function renderWorkflow() {
      const pips = data.pipelines;
      if (!pips || !pips.length) return '<div class="empty">暂无管道</div>';
      const rows = pips.map(p =>
        '<tr><td><strong>' + p.name + '</strong></td><td>' + (p.description || '') + '</td>' +
        '<td><span class="badge badge-purple">' + p.version + '</span></td>' +
        '<td>' + p.nodeCount + ' 节点 / ' + p.edgeCount + ' 边</td></tr>'
      ).join('');
      return '<div class="card"><h2><span class="icon">🔄</span>Workflow 管道</h2><table><thead><tr><th>名称</th><th>描述</th><th>版本</th><th>结构</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    }

    async function installPkg(name) {
      const r = await fetch(API + '/api/marketplace/install', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({packageName: name})
      });
      const result = await r.json();
      alert(result.success ? '安装成功: ' + name : '安装失败: ' + result.error);
      loadAll();
    }

    loadAll();
    setInterval(loadAll, 15000);
  </script>
</body>
</html>`;
  }

  // ==================== 辅助方法 ====================

  private json(res: ServerResponse, data: unknown, status = 200): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data, null, 2));
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => resolve(body));
    });
  }
}
