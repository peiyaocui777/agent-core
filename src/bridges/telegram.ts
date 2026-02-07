/**
 * Telegram Bot 桥接层
 *
 * 参考 OpenClaw 的 Chat-First 设计：
 * - 通过 Telegram 收发消息，作为主交互入口
 * - 支持自然语言指令、命令菜单、Inline Keyboard
 * - 执行结果实时反馈
 * - 文件/图片交互（发图 → 上传图床 → AI 配文）
 * - Heartbeat 主动推送
 *
 * 使用 grammy 框架（TypeScript 原生）
 */

import { Bot, Context, InlineKeyboard, session } from "grammy";
import type { AgentCore } from "../agent.js";
import type { AgentTask } from "../types.js";

// ==================== 配置 ====================

export interface TelegramBridgeConfig {
  /** Telegram Bot Token (从 @BotFather 获取) */
  token: string;
  /** 允许的用户 ID 列表（安全控制，为空则允许所有人） */
  allowedUsers?: number[];
  /** Bot 名称 */
  botName?: string;
  /** 是否启用 Heartbeat */
  enableHeartbeat?: boolean;
  /** Heartbeat 间隔（毫秒），默认 4 小时 */
  heartbeatInterval?: number;
}

// ==================== Telegram Bridge ====================

export class TelegramBridge {
  private bot: Bot;
  private agent: AgentCore;
  private config: TelegramBridgeConfig;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private activeChatIds: Set<number> = new Set();

  constructor(agent: AgentCore, config: TelegramBridgeConfig) {
    this.agent = agent;
    this.config = config;
    this.bot = new Bot(config.token);

    this.setupMiddleware();
    this.setupCommands();
    this.setupMessageHandlers();
  }

  // ==================== 中间件 ====================

  private setupMiddleware(): void {
    // 权限检查
    this.bot.use(async (ctx, next) => {
      const userId = ctx.from?.id;
      if (!userId) return;

      // 如果配置了白名单，只允许白名单用户
      if (this.config.allowedUsers?.length && !this.config.allowedUsers.includes(userId)) {
        await ctx.reply("⛔ 你没有使用此 Bot 的权限。");
        return;
      }

      // 记录活跃 Chat ID（用于 Heartbeat 推送）
      if (ctx.chat?.id) {
        this.activeChatIds.add(ctx.chat.id);
      }

      await next();
    });
  }

  // ==================== 命令注册 ====================

  private setupCommands(): void {
    const botName = this.config.botName || "Jarvis";

    // /start — 欢迎消息
    this.bot.command("start", async (ctx) => {
      const name = ctx.from?.first_name || "朋友";
      await ctx.reply(
        `你好 ${name}！我是 ${botName}，你的 AI 分身助手。\n\n` +
        `直接发消息给我就行，我能帮你：\n` +
        `- 采集热点话题\n` +
        `- AI 生成小红书/公众号内容\n` +
        `- 一键多平台发布\n` +
        `- 定时自动运营\n\n` +
        `输入 /help 查看所有命令。`,
        { parse_mode: "Markdown" }
      );
    });

    // /help — 帮助
    this.bot.command("help", async (ctx) => {
      await ctx.reply(
        `*命令列表*\n\n` +
        `/publish <主题> — 生成并发布内容\n` +
        `/trending — 查看当前热点\n` +
        `/status — 查看系统状态\n` +
        `/skills — 查看已加载技能\n` +
        `/memory — 查看记忆统计\n` +
        `/history — 查看发布历史\n` +
        `/profile — 查看/设置用户画像\n` +
        `/quick — 快捷操作面板\n\n` +
        `或者直接用自然语言告诉我你想做什么！`,
        { parse_mode: "Markdown" }
      );
    });

    // /publish — 快速发布
    this.bot.command("publish", async (ctx) => {
      const topic = ctx.match?.trim();
      if (!topic) {
        // 显示平台选择菜单
        const keyboard = new InlineKeyboard()
          .text("小红书", "publish:xhs")
          .text("公众号", "publish:wechat")
          .row()
          .text("全平台", "publish:all")
          .text("取消", "cancel");

        await ctx.reply("请选择发布平台，或输入 `/publish <主题>` 直接发布:", {
          reply_markup: keyboard,
        });
        return;
      }

      await this.handleInstruction(ctx, `帮我发一篇关于${topic}的内容到小红书和公众号`);
    });

    // /trending — 热点话题
    this.bot.command("trending", async (ctx) => {
      await this.handleInstruction(ctx, "采集今天的热点话题");
    });

    // /status — 系统状态
    this.bot.command("status", async (ctx) => {
      const status = this.agent.getStatus();
      const skillStatus = this.agent.skills.getStatus();

      let text = `*系统状态*\n\n`;
      text += `Skills: ${status.skills.active}/${status.skills.total} 激活\n`;
      text += `工具: ${status.tools} 个\n`;
      text += `记忆: ${status.memory.memories} 条\n`;
      text += `发布记录: ${status.memory.publishHistory} 条\n`;
      text += `任务执行: ${status.tasks} 次\n\n`;

      text += `*技能列表*\n`;
      for (const s of skillStatus) {
        text += `${s.active ? "✅" : "⬜"} ${s.name} (${s.toolCount} 工具)\n`;
      }

      await ctx.reply(text, { parse_mode: "Markdown" });
    });

    // /skills — 技能列表
    this.bot.command("skills", async (ctx) => {
      const skills = this.agent.skills.getStatus();
      let text = `*已加载技能 (${skills.length})*\n\n`;

      for (const s of skills) {
        text += `${s.active ? "✅" : "⬜"} *${s.name}*\n`;
        text += `  ${s.description}\n`;
        text += `  工具: ${s.tools.join(", ")}\n\n`;
      }

      await ctx.reply(text, { parse_mode: "Markdown" });
    });

    // /memory — 记忆统计
    this.bot.command("memory", async (ctx) => {
      const profile = this.agent.memory.getProfile();
      const stats = this.agent.memory.getPublishStats();

      let text = `*记忆系统*\n\n`;
      text += `*用户画像*\n`;
      if (profile.nickname) text += `昵称: ${profile.nickname}\n`;
      if (profile.preferredTopics?.length) text += `偏好: ${profile.preferredTopics.join(", ")}\n`;
      if (profile.platforms?.length) text += `平台: ${profile.platforms.join(", ")}\n`;

      text += `\n*发布统计*\n`;
      text += `总计: ${stats.total} 次\n`;
      text += `成功: ${stats.success} 次\n`;
      text += `失败: ${stats.failed} 次\n`;
      text += `近 7 天: ${stats.recentDays} 次\n`;

      if (Object.keys(stats.byPlatform).length) {
        text += `\n*平台分布*\n`;
        for (const [platform, data] of Object.entries(stats.byPlatform)) {
          text += `${platform}: ${data.success}/${data.total}\n`;
        }
      }

      await ctx.reply(text, { parse_mode: "Markdown" });
    });

    // /history — 发布历史
    this.bot.command("history", async (ctx) => {
      const history = this.agent.memory.getPublishHistory({ limit: 10 });

      if (history.length === 0) {
        await ctx.reply("暂无发布记录。");
        return;
      }

      let text = `*最近发布 (${history.length})*\n\n`;
      for (const record of history) {
        const icon = record.status === "success" ? "✅" : "❌";
        const date = new Date(record.publishedAt).toLocaleString("zh-CN");
        text += `${icon} *${record.title}*\n`;
        text += `  平台: ${record.platform} | ${date}\n`;
        if (record.url) text += `  [链接](${record.url})\n`;
        text += `\n`;
      }

      await ctx.reply(text, { parse_mode: "Markdown" });
    });

    // /profile — 用户画像
    this.bot.command("profile", async (ctx) => {
      const args = ctx.match?.trim();
      if (!args) {
        const profile = this.agent.memory.getProfile();
        const keyboard = new InlineKeyboard()
          .text("设置昵称", "profile:nickname")
          .text("设置偏好", "profile:topics")
          .row()
          .text("设置平台", "profile:platforms")
          .text("设置风格", "profile:style");

        await ctx.reply(
          `*当前画像*\n\n` +
          `昵称: ${profile.nickname || "未设置"}\n` +
          `偏好领域: ${profile.preferredTopics?.join(", ") || "未设置"}\n` +
          `常用平台: ${profile.platforms?.join(", ") || "未设置"}\n` +
          `写作风格: ${profile.preferredStyle || "未设置"}\n\n` +
          `点击按钮或输入 \`/profile 昵称=小鱼\` 设置`,
          { parse_mode: "Markdown", reply_markup: keyboard }
        );
        return;
      }

      // 简单解析 key=value
      const pairs = args.split(/\s+/).map((p) => p.split("="));
      for (const [key, value] of pairs) {
        if (!value) continue;
        const fieldMap: Record<string, string> = {
          "昵称": "nickname",
          "nickname": "nickname",
          "偏好": "preferredTopics",
          "topics": "preferredTopics",
          "平台": "platforms",
          "platforms": "platforms",
          "风格": "preferredStyle",
          "style": "preferredStyle",
        };
        const field = fieldMap[key];
        if (field) {
          const val = field.includes("s") && field !== "preferredStyle"
            ? value.split(",")
            : value;
          this.agent.memory.updateProfile(field, val);
        }
      }
      await ctx.reply("✅ 画像已更新！");
    });

    // /quick — 快捷操作面板
    this.bot.command("quick", async (ctx) => {
      const keyboard = new InlineKeyboard()
        .text("🔥 热点采集", "quick:trending")
        .text("✍️ AI 写文", "quick:write")
        .row()
        .text("📱 发小红书", "quick:xhs")
        .text("📢 发公众号", "quick:wechat")
        .row()
        .text("🚀 全平台发布", "quick:all")
        .text("📊 今日统计", "quick:stats");

      await ctx.reply("快捷操作面板：", { reply_markup: keyboard });
    });
  }

  // ==================== 消息处理 ====================

  private setupMessageHandlers(): void {
    // Inline Keyboard 回调
    this.bot.on("callback_query:data", async (ctx) => {
      const data = ctx.callbackQuery.data;
      await ctx.answerCallbackQuery();

      // 快捷操作
      if (data.startsWith("quick:")) {
        const action = data.split(":")[1];
        const actionMap: Record<string, string> = {
          trending: "采集今天的热点话题",
          write: "帮我生成一篇AI相关的内容",
          xhs: "帮我发一篇关于AI的小红书笔记",
          wechat: "帮我发一篇关于AI的公众号文章",
          all: "帮我一键发布到所有平台",
          stats: "", // 特殊处理
        };

        if (action === "stats") {
          const stats = this.agent.memory.getPublishStats();
          await ctx.editMessageText(
            `📊 *今日统计*\n\n` +
            `总发布: ${stats.total}\n` +
            `成功率: ${stats.total ? Math.round((stats.success / stats.total) * 100) : 0}%\n` +
            `近 7 天: ${stats.recentDays} 次`,
            { parse_mode: "Markdown" }
          );
          return;
        }

        if (actionMap[action]) {
          await ctx.editMessageText(`⏳ 正在执行: ${actionMap[action]}`);
          await this.handleInstruction(ctx, actionMap[action]);
        }
        return;
      }

      // 发布平台选择
      if (data.startsWith("publish:")) {
        const platform = data.split(":")[1];
        if (platform === "cancel") {
          await ctx.editMessageText("已取消。");
          return;
        }
        await ctx.editMessageText(`请输入要发布的主题内容：`);
        // 记住等待输入状态（简化处理：下一条消息自动作为该平台发布）
        this.agent.memory.remember(`_pending_publish`, platform, ["system"]);
        return;
      }

      // profile 设置
      if (data.startsWith("profile:")) {
        const field = data.split(":")[1];
        const prompts: Record<string, string> = {
          nickname: "请输入你的昵称：",
          topics: "请输入偏好领域（逗号分隔，如 AI,副业,效率）：",
          platforms: "请输入常用平台（逗号分隔，如 xiaohongshu,wechat）：",
          style: "请输入写作风格（如 轻松种草、专业深度、幽默搞怪）：",
        };
        await ctx.editMessageText(prompts[field] || "请输入值：");
        this.agent.memory.remember(`_pending_profile`, field, ["system"]);
        return;
      }
    });

    // 图片消息 → 上传图床
    this.bot.on("message:photo", async (ctx) => {
      await ctx.reply("📸 收到图片，正在处理...");
      try {
        const photo = ctx.message.photo;
        const largest = photo[photo.length - 1];
        const file = await ctx.api.getFile(largest.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${this.config.token}/${file.file_path}`;

        // 上传到图床
        const result = await this.agent.executeTool("upload-image", {
          imageUrl: fileUrl,
        });

        if (result.success) {
          const data = result.data as Record<string, unknown>;
          await ctx.reply(
            `✅ 图片已上传到图床\n` +
            `URL: ${data.url || data.imageUrl || "(链接生成中)"}\n\n` +
            `回复主题文字，我帮你生成配文并发布。`
          );
        } else {
          await ctx.reply(`⚠️ 图片上传失败: ${result.error}`);
        }
      } catch (error) {
        await ctx.reply(`❌ 处理图片失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    // 文本消息 — 自然语言处理
    this.bot.on("message:text", async (ctx) => {
      const text = ctx.message.text;

      // 如果是命令（/开头），已经由上面的 handler 处理
      if (text.startsWith("/")) return;

      // 检查是否有待处理的 profile 设置
      const pendingProfile = this.agent.memory.recall("_pending_profile", 1);
      if (pendingProfile.length > 0 && pendingProfile[0].value) {
        const field = String(pendingProfile[0].value);
        const fieldMap: Record<string, string> = {
          nickname: "nickname",
          topics: "preferredTopics",
          platforms: "platforms",
          style: "preferredStyle",
        };

        const actualField = fieldMap[field];
        if (actualField) {
          const val = (actualField === "preferredTopics" || actualField === "platforms")
            ? text.split(/[,，]/).map((s) => s.trim())
            : text;
          this.agent.memory.updateProfile(actualField, val);
          this.agent.memory.forget("_pending_profile");
          await ctx.reply(`✅ 已设置 ${field} = ${text}`);
          return;
        }
      }

      // 检查是否有待处理的发布
      const pendingPublish = this.agent.memory.recall("_pending_publish", 1);
      if (pendingPublish.length > 0 && pendingPublish[0].value) {
        const platform = String(pendingPublish[0].value);
        this.agent.memory.forget("_pending_publish");

        const platformName: Record<string, string> = {
          xhs: "小红书",
          wechat: "公众号",
          all: "所有平台",
        };
        await this.handleInstruction(ctx, `帮我发一篇关于${text}的内容到${platformName[platform] || platform}`);
        return;
      }

      // 默认：当作自然语言指令处理
      await this.handleInstruction(ctx, text);
    });
  }

  // ==================== 核心：执行指令并反馈 ====================

  private async handleInstruction(ctx: Context, instruction: string): Promise<void> {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    // 发送 "正在思考" 提示
    const thinkingMsg = await ctx.reply("🤔 正在思考...");

    try {
      // 执行 Agent 指令
      const task = await this.agent.run(instruction);

      // 格式化结果
      const resultText = this.formatTaskResult(task);

      // 编辑或发送结果
      try {
        await ctx.api.editMessageText(chatId, thinkingMsg.message_id, resultText, {
          parse_mode: "Markdown",
        });
      } catch {
        // 如果编辑失败（消息太长等），直接发新消息
        await ctx.reply(resultText, { parse_mode: "Markdown" });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      try {
        await ctx.api.editMessageText(
          chatId,
          thinkingMsg.message_id,
          `❌ 执行失败: ${errorMsg}`
        );
      } catch {
        await ctx.reply(`❌ 执行失败: ${errorMsg}`);
      }
    }
  }

  // ==================== 结果格式化 ====================

  private formatTaskResult(task: AgentTask): string {
    const icon = task.status === "completed" ? "✅" : "❌";
    let text = `${icon} *任务${task.status === "completed" ? "完成" : "失败"}*\n\n`;

    for (const step of task.steps) {
      const stepIcon = step.status === "completed" ? "✅" :
        step.status === "failed" ? "❌" :
        step.status === "skipped" ? "⏭" : "⏳";

      text += `${stepIcon} \`${step.toolName}\`\n`;

      if (step.result?.data) {
        const data = step.result.data as Record<string, unknown>;
        if (data.title) text += `  标题: ${data.title}\n`;
        if (data.content && typeof data.content === "string") {
          const preview = data.content.length > 100
            ? data.content.slice(0, 100) + "..."
            : data.content;
          text += `  内容: ${preview}\n`;
        }
        if (data.tags && Array.isArray(data.tags)) {
          text += `  标签: ${(data.tags as string[]).slice(0, 5).join(", ")}\n`;
        }
        if (data.url) text += `  链接: ${data.url}\n`;
        if (data.topics && Array.isArray(data.topics)) {
          text += `  热点:\n`;
          for (const topic of (data.topics as Array<{ title: string }>).slice(0, 5)) {
            text += `    • ${topic.title}\n`;
          }
        }
        if (data._fallback) text += `  _(Fallback 模式)_\n`;
      }

      if (step.result?.error) {
        text += `  错误: ${step.result.error}\n`;
      }

      text += `\n`;
    }

    // 执行时间
    if (task.completedAt && task.createdAt) {
      const duration = new Date(task.completedAt).getTime() - new Date(task.createdAt).getTime();
      text += `⏱ 耗时: ${duration}ms`;
    }

    return text;
  }

  // ==================== Heartbeat ====================

  /**
   * 启动 Heartbeat 定时推送
   * 定时向活跃用户推送摘要
   */
  startHeartbeat(): void {
    if (!this.config.enableHeartbeat) return;

    const interval = this.config.heartbeatInterval || 4 * 60 * 60 * 1000; // 默认 4 小时

    this.heartbeatTimer = setInterval(async () => {
      await this.sendHeartbeat();
    }, interval);

    console.log(`[Telegram] Heartbeat 已启动，间隔 ${interval / 1000}s`);
  }

  /** 发送 Heartbeat 消息 */
  async sendHeartbeat(): Promise<void> {
    if (this.activeChatIds.size === 0) return;

    const stats = this.agent.memory.getPublishStats();
    const profile = this.agent.memory.getProfile();

    const text =
      `🫀 *Heartbeat — ${this.config.botName || "Jarvis"} 近况报告*\n\n` +
      `📊 发布统计: ${stats.success}/${stats.total} 成功\n` +
      `📅 近 7 天: ${stats.recentDays} 次发布\n` +
      (profile.preferredTopics?.length
        ? `🎯 关注领域: ${profile.preferredTopics.join(", ")}\n`
        : "") +
      `\n输入 /quick 快速操作`;

    for (const chatId of this.activeChatIds) {
      try {
        await this.bot.api.sendMessage(chatId, text, { parse_mode: "Markdown" });
      } catch (error) {
        console.error(`[Telegram] Heartbeat 发送失败 (chat: ${chatId}):`, error);
        // 如果发送失败，移除此 chatId
        this.activeChatIds.delete(chatId);
      }
    }
  }

  /** 向特定 Chat 发送消息（用于外部调用） */
  async sendMessage(chatId: number, text: string): Promise<void> {
    await this.bot.api.sendMessage(chatId, text, { parse_mode: "Markdown" });
  }

  // ==================== 生命周期 ====================

  /** 启动 Bot */
  async start(): Promise<void> {
    // 设置命令菜单
    await this.bot.api.setMyCommands([
      { command: "start", description: "开始使用" },
      { command: "help", description: "帮助信息" },
      { command: "publish", description: "发布内容" },
      { command: "trending", description: "热点话题" },
      { command: "status", description: "系统状态" },
      { command: "skills", description: "技能列表" },
      { command: "memory", description: "记忆统计" },
      { command: "history", description: "发布历史" },
      { command: "profile", description: "用户画像" },
      { command: "quick", description: "快捷操作" },
    ]);

    // 启动 Heartbeat
    this.startHeartbeat();

    // 启动 long polling
    console.log(`[Telegram] Bot 启动中...`);
    this.bot.start({
      onStart: (info) => {
        console.log(`[Telegram] Bot 已启动: @${info.username}`);
      },
    });
  }

  /** 停止 Bot */
  async stop(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    await this.bot.stop();
    console.log("[Telegram] Bot 已停止");
  }
}
