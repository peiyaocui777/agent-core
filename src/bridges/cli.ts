/**
 * CLI 交互模式 — 终端对话
 *
 * 在终端中与 Jarvis 进行对话式交互。
 * 支持：
 * - 自然语言指令
 * - 命令（以 / 开头）
 * - 多行输入
 * - 彩色输出
 */

import * as readline from "readline";
import type { AgentCore } from "../agent.js";
import type { PersonaManager } from "../persona/persona.js";
import type { AgentTask } from "../types.js";

// ==================== ANSI 颜色 ====================

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

// ==================== CLI Bridge ====================

export class CLIBridge {
  private agent: AgentCore;
  private persona?: PersonaManager;
  private rl: readline.Interface | null = null;
  private running = false;

  constructor(agent: AgentCore, persona?: PersonaManager) {
    this.agent = agent;
    this.persona = persona;
  }

  /** 启动 CLI 交互循环 */
  async start(): Promise<void> {
    this.running = true;

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const botName = this.persona?.getCurrent().name || "Jarvis";

    // 打印欢迎信息
    console.log();
    console.log(`${C.cyan}${C.bold}═══════════════════════════════════════${C.reset}`);
    console.log(`${C.cyan}${C.bold}  ${botName} — AI 分身终端模式${C.reset}`);
    console.log(`${C.cyan}${C.bold}═══════════════════════════════════════${C.reset}`);
    console.log();

    const status = this.agent.getStatus();
    console.log(`${C.dim}Skills: ${status.skills.active} 个激活 | 工具: ${status.tools} 个 | 记忆: ${status.memory.memories} 条${C.reset}`);
    console.log(`${C.dim}输入自然语言指令或 /help 查看命令。Ctrl+C 退出。${C.reset}`);
    console.log();

    // 交互循环
    const prompt = () => {
      this.rl?.question(`${C.green}你 >${C.reset} `, async (input) => {
        const trimmed = input.trim();
        if (!trimmed) {
          if (this.running) prompt();
          return;
        }

        try {
          await this.handleInput(trimmed);
        } catch (error) {
          console.error(`${C.red}错误: ${error instanceof Error ? error.message : String(error)}${C.reset}`);
        }

        if (this.running) prompt();
      });
    };

    prompt();

    // 优雅退出
    this.rl.on("close", () => {
      this.running = false;
      console.log(`\n${C.dim}${botName} 已离线。再见！${C.reset}`);
    });
  }

  /** 停止 CLI */
  stop(): void {
    this.running = false;
    this.rl?.close();
  }

  // ==================== 输入处理 ====================

  private async handleInput(input: string): Promise<void> {
    // 命令处理
    if (input.startsWith("/")) {
      await this.handleCommand(input);
      return;
    }

    // 自然语言指令
    const botName = this.persona?.getCurrent().name || "Jarvis";
    console.log(`\n${C.cyan}${botName} >${C.reset} ${C.dim}正在思考...${C.reset}`);

    const task = await this.agent.run(input);
    this.printTaskResult(task);
  }

  // ==================== 命令处理 ====================

  private async handleCommand(input: string): Promise<void> {
    const [cmd, ...args] = input.split(/\s+/);
    const arg = args.join(" ");

    switch (cmd) {
      case "/help":
        this.printHelp();
        break;

      case "/status":
        this.printStatus();
        break;

      case "/skills":
        this.printSkills();
        break;

      case "/memory":
        this.printMemory();
        break;

      case "/history":
        this.printHistory();
        break;

      case "/profile":
        if (arg) {
          this.setProfile(arg);
        } else {
          this.printProfile();
        }
        break;

      case "/persona":
        if (arg) {
          const ok = this.persona?.switchTo(arg);
          console.log(ok ? `${C.green}已切换到: ${arg}${C.reset}` : `${C.red}未找到人格: ${arg}${C.reset}`);
        } else {
          this.printPersonas();
        }
        break;

      case "/trending":
        await this.handleInput("采集今天的热点话题");
        break;

      case "/publish":
        if (arg) {
          await this.handleInput(`帮我发一篇关于${arg}的小红书笔记`);
        } else {
          console.log(`${C.yellow}用法: /publish <主题>${C.reset}`);
        }
        break;

      case "/quit":
      case "/exit":
        this.stop();
        break;

      default:
        console.log(`${C.yellow}未知命令: ${cmd}，输入 /help 查看帮助${C.reset}`);
    }
  }

  // ==================== 输出格式化 ====================

  private printHelp(): void {
    console.log(`
${C.bold}命令列表${C.reset}

${C.cyan}/help${C.reset}        显示帮助
${C.cyan}/status${C.reset}      系统状态
${C.cyan}/skills${C.reset}      已加载技能
${C.cyan}/memory${C.reset}      记忆统计
${C.cyan}/history${C.reset}     发布历史
${C.cyan}/profile${C.reset}     用户画像
${C.cyan}/persona${C.reset}     切换人格
${C.cyan}/trending${C.reset}    查看热点
${C.cyan}/publish${C.reset}     发布内容
${C.cyan}/quit${C.reset}        退出

${C.dim}或直接输入自然语言指令。${C.reset}
`);
  }

  private printStatus(): void {
    const s = this.agent.getStatus();
    console.log(`
${C.bold}系统状态${C.reset}
  Skills:  ${C.green}${s.skills.active}${C.reset}/${s.skills.total} 激活
  工具:    ${C.green}${s.tools}${C.reset} 个
  记忆:    ${s.memory.memories} 条
  发布:    ${s.memory.publishHistory} 条
  任务:    ${s.tasks} 次
`);
  }

  private printSkills(): void {
    const skills = this.agent.skills.getStatus();
    console.log(`\n${C.bold}已加载技能 (${skills.length})${C.reset}\n`);
    for (const s of skills) {
      const icon = s.active ? `${C.green}✓${C.reset}` : `${C.dim}○${C.reset}`;
      console.log(`  ${icon} ${C.bold}${s.name}${C.reset} [${s.category}]`);
      console.log(`    ${C.dim}${s.description}${C.reset}`);
      console.log(`    ${C.dim}工具: ${s.tools.join(", ")}${C.reset}`);
    }
    console.log();
  }

  private printMemory(): void {
    const profile = this.agent.memory.getProfile();
    const stats = this.agent.memory.getPublishStats();
    console.log(`
${C.bold}记忆系统${C.reset}

  ${C.bold}用户画像${C.reset}
    昵称: ${profile.nickname || "(未设置)"}
    偏好: ${profile.preferredTopics?.join(", ") || "(未设置)"}
    平台: ${profile.platforms?.join(", ") || "(未设置)"}
    风格: ${profile.preferredStyle || "(未设置)"}

  ${C.bold}发布统计${C.reset}
    总计: ${stats.total}  成功: ${C.green}${stats.success}${C.reset}  失败: ${C.red}${stats.failed}${C.reset}
    近 7 天: ${stats.recentDays} 次
`);
  }

  private printHistory(): void {
    const history = this.agent.memory.getPublishHistory({ limit: 10 });
    if (history.length === 0) {
      console.log(`\n${C.dim}暂无发布记录。${C.reset}\n`);
      return;
    }

    console.log(`\n${C.bold}最近发布 (${history.length})${C.reset}\n`);
    for (const r of history) {
      const icon = r.status === "success" ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;
      const date = new Date(r.publishedAt).toLocaleString("zh-CN");
      console.log(`  ${icon} ${C.bold}${r.title}${C.reset}`);
      console.log(`    ${C.dim}${r.platform} | ${date}${r.url ? ` | ${r.url}` : ""}${C.reset}`);
    }
    console.log();
  }

  private printProfile(): void {
    const profile = this.agent.memory.getProfile();
    console.log(`
${C.bold}用户画像${C.reset}
  昵称: ${profile.nickname || "(未设置)"}
  偏好: ${profile.preferredTopics?.join(", ") || "(未设置)"}
  平台: ${profile.platforms?.join(", ") || "(未设置)"}
  风格: ${profile.preferredStyle || "(未设置)"}

${C.dim}设置: /profile 昵称=小鱼 偏好=AI,副业${C.reset}
`);
  }

  private setProfile(args: string): void {
    const pairs = args.split(/\s+/);
    for (const pair of pairs) {
      const [key, value] = pair.split("=");
      if (!value) continue;
      const fieldMap: Record<string, string> = {
        "昵称": "nickname", "nickname": "nickname",
        "偏好": "preferredTopics", "topics": "preferredTopics",
        "平台": "platforms", "platforms": "platforms",
        "风格": "preferredStyle", "style": "preferredStyle",
      };
      const field = fieldMap[key];
      if (field) {
        const val = (field === "preferredTopics" || field === "platforms")
          ? value.split(",")
          : value;
        this.agent.memory.updateProfile(field, val);
        console.log(`${C.green}✓ ${key} = ${value}${C.reset}`);
      }
    }
  }

  private printPersonas(): void {
    if (!this.persona) {
      console.log(`${C.dim}Persona 未配置。${C.reset}`);
      return;
    }
    const all = this.persona.listAll();
    console.log(`\n${C.bold}可用人格${C.reset}\n`);
    for (const p of all) {
      const icon = p.active ? `${C.green}▶${C.reset}` : `${C.dim}○${C.reset}`;
      console.log(`  ${icon} ${C.bold}${p.name}${C.reset} — ${p.role}`);
    }
    console.log(`\n${C.dim}切换: /persona <名称>${C.reset}\n`);
  }

  private printTaskResult(task: AgentTask): void {
    const botName = this.persona?.getCurrent().name || "Jarvis";
    const icon = task.status === "completed" ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;

    console.log(`\n${C.cyan}${botName} >${C.reset} ${icon} 任务${task.status === "completed" ? "完成" : "失败"}\n`);

    for (const step of task.steps) {
      const sIcon = step.status === "completed" ? `${C.green}✓${C.reset}` :
        step.status === "failed" ? `${C.red}✗${C.reset}` : `${C.dim}○${C.reset}`;

      console.log(`  ${sIcon} ${C.bold}${step.toolName}${C.reset}`);

      if (step.result?.data) {
        const data = step.result.data as Record<string, unknown>;
        if (data.title) console.log(`    标题: ${data.title}`);
        if (data.content && typeof data.content === "string") {
          const preview = data.content.length > 150
            ? data.content.slice(0, 150) + "..."
            : data.content;
          console.log(`    内容: ${C.dim}${preview}${C.reset}`);
        }
        if (data.tags && Array.isArray(data.tags)) {
          console.log(`    标签: ${(data.tags as string[]).slice(0, 5).join(", ")}`);
        }
        if (data._fallback) console.log(`    ${C.yellow}(Fallback 模式)${C.reset}`);
      }

      if (step.result?.error) {
        console.log(`    ${C.red}错误: ${step.result.error}${C.reset}`);
      }
    }

    if (task.completedAt && task.createdAt) {
      const duration = new Date(task.completedAt).getTime() - new Date(task.createdAt).getTime();
      console.log(`\n  ${C.dim}耗时: ${duration}ms${C.reset}`);
    }
    console.log();
  }
}
