/**
 * ConversationManager — 对话管理器
 *
 * 完整的对话生命周期管理：
 * 1. 创建/切换/删除对话
 * 2. 消息持久化（JSON）
 * 3. 对话搜索（按内容/时间/标签）
 * 4. 导出（JSON/Markdown/TXT）
 * 5. 消息编辑/删除/重新生成标记
 * 6. 对话摘要自动生成
 */

import * as fs from "fs";
import * as path from "path";

// ==================== 类型 ====================

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  edited?: boolean;
  metadata?: {
    model?: string;
    tokensUsed?: number;
    toolsCalled?: string[];
    ragContext?: boolean;
  };
}

export interface Conversation {
  id: string;
  title: string;
  messages: ConversationMessage[];
  createdAt: string;
  updatedAt: string;
  tags: string[];
  pinned: boolean;
  archived: boolean;
  summary?: string;
  metadata?: {
    messageCount: number;
    totalTokens?: number;
  };
}

export interface ConversationManagerConfig {
  dataPath: string;
  maxConversations: number;
  maxMessagesPerConversation: number;
  autoSummary: boolean;
}

export interface ConversationSearchOptions {
  keyword?: string;
  tags?: string[];
  dateFrom?: string;
  dateTo?: string;
  pinned?: boolean;
  archived?: boolean;
}

// ==================== ConversationManager ====================

export class ConversationManager {
  private config: ConversationManagerConfig;
  private conversations: Conversation[] = [];

  constructor(config?: Partial<ConversationManagerConfig>) {
    this.config = {
      dataPath: "/tmp/jarvis-conversations.json",
      maxConversations: 200,
      maxMessagesPerConversation: 500,
      autoSummary: true,
      ...config,
    };
    this.load();
  }

  // ==================== 对话 CRUD ====================

  /** 创建新对话 */
  createConversation(title?: string, tags?: string[]): Conversation {
    const conv: Conversation = {
      id: `conv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: title || `对话 ${this.conversations.length + 1}`,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tags: tags || [],
      pinned: false,
      archived: false,
      metadata: { messageCount: 0 },
    };

    this.conversations.push(conv);

    // 限制总数
    if (this.conversations.length > this.config.maxConversations) {
      const nonPinned = this.conversations.filter((c) => !c.pinned && !c.archived);
      if (nonPinned.length > 0) {
        const oldest = nonPinned[0];
        this.conversations = this.conversations.filter((c) => c.id !== oldest.id);
      }
    }

    this.save();
    return conv;
  }

  /** 获取对话 */
  getConversation(id: string): Conversation | undefined {
    return this.conversations.find((c) => c.id === id);
  }

  /** 删除对话 */
  deleteConversation(id: string): boolean {
    const idx = this.conversations.findIndex((c) => c.id === id);
    if (idx < 0) return false;
    this.conversations.splice(idx, 1);
    this.save();
    return true;
  }

  /** 列出对话（最近的在前） */
  listConversations(options?: ConversationSearchOptions): Array<{
    id: string;
    title: string;
    messageCount: number;
    lastMessage?: string;
    updatedAt: string;
    tags: string[];
    pinned: boolean;
    archived: boolean;
    summary?: string;
  }> {
    let filtered = this.conversations;

    if (options?.keyword) {
      const kw = options.keyword.toLowerCase();
      filtered = filtered.filter(
        (c) =>
          c.title.toLowerCase().includes(kw) ||
          c.messages.some((m) => m.content.toLowerCase().includes(kw))
      );
    }
    if (options?.tags && options.tags.length > 0) {
      filtered = filtered.filter((c) => options.tags!.some((t) => c.tags.includes(t)));
    }
    if (options?.dateFrom) {
      filtered = filtered.filter((c) => c.updatedAt >= options.dateFrom!);
    }
    if (options?.dateTo) {
      filtered = filtered.filter((c) => c.updatedAt <= options.dateTo!);
    }
    if (options?.pinned !== undefined) {
      filtered = filtered.filter((c) => c.pinned === options.pinned);
    }
    if (options?.archived !== undefined) {
      filtered = filtered.filter((c) => c.archived === options.archived);
    }

    return filtered
      .sort((a, b) => {
        // 置顶的排前面
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      })
      .map((c) => ({
        id: c.id,
        title: c.title,
        messageCount: c.messages.length,
        lastMessage: c.messages[c.messages.length - 1]?.content.slice(0, 100),
        updatedAt: c.updatedAt,
        tags: c.tags,
        pinned: c.pinned,
        archived: c.archived,
        summary: c.summary,
      }));
  }

  // ==================== 消息操作 ====================

  /** 添加消息 */
  addMessage(
    conversationId: string,
    role: "user" | "assistant" | "system",
    content: string,
    metadata?: ConversationMessage["metadata"]
  ): ConversationMessage | null {
    const conv = this.conversations.find((c) => c.id === conversationId);
    if (!conv) return null;

    const msg: ConversationMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role,
      content,
      timestamp: new Date().toISOString(),
      metadata,
    };

    conv.messages.push(msg);
    conv.updatedAt = new Date().toISOString();
    conv.metadata = { ...conv.metadata, messageCount: conv.messages.length };

    // 限制消息数
    if (conv.messages.length > this.config.maxMessagesPerConversation) {
      conv.messages = conv.messages.slice(-this.config.maxMessagesPerConversation);
    }

    // 自动标题（第一条用户消息）
    if (conv.messages.filter((m) => m.role === "user").length === 1 && role === "user") {
      conv.title = content.slice(0, 50) + (content.length > 50 ? "..." : "");
    }

    this.save();
    return msg;
  }

  /** 编辑消息 */
  editMessage(conversationId: string, messageId: string, newContent: string): boolean {
    const conv = this.conversations.find((c) => c.id === conversationId);
    if (!conv) return false;
    const msg = conv.messages.find((m) => m.id === messageId);
    if (!msg) return false;
    msg.content = newContent;
    msg.edited = true;
    this.save();
    return true;
  }

  /** 删除消息 */
  deleteMessage(conversationId: string, messageId: string): boolean {
    const conv = this.conversations.find((c) => c.id === conversationId);
    if (!conv) return false;
    const idx = conv.messages.findIndex((m) => m.id === messageId);
    if (idx < 0) return false;
    conv.messages.splice(idx, 1);
    conv.metadata = { ...conv.metadata, messageCount: conv.messages.length };
    this.save();
    return true;
  }

  // ==================== 对话操作 ====================

  /** 置顶/取消置顶 */
  togglePin(id: string): boolean {
    const conv = this.conversations.find((c) => c.id === id);
    if (!conv) return false;
    conv.pinned = !conv.pinned;
    this.save();
    return true;
  }

  /** 归档/取消归档 */
  toggleArchive(id: string): boolean {
    const conv = this.conversations.find((c) => c.id === id);
    if (!conv) return false;
    conv.archived = !conv.archived;
    this.save();
    return true;
  }

  /** 添加标签 */
  addTag(id: string, tag: string): boolean {
    const conv = this.conversations.find((c) => c.id === id);
    if (!conv) return false;
    if (!conv.tags.includes(tag)) conv.tags.push(tag);
    this.save();
    return true;
  }

  /** 设置摘要 */
  setSummary(id: string, summary: string): boolean {
    const conv = this.conversations.find((c) => c.id === id);
    if (!conv) return false;
    conv.summary = summary;
    this.save();
    return true;
  }

  /** 重命名 */
  rename(id: string, title: string): boolean {
    const conv = this.conversations.find((c) => c.id === id);
    if (!conv) return false;
    conv.title = title;
    this.save();
    return true;
  }

  // ==================== 导出 ====================

  /** 导出对话 */
  exportConversation(id: string, format: string = "json"): string {
    const conv = this.conversations.find((c) => c.id === id);
    if (!conv) return "";

    switch (format) {
      case "markdown": {
        let md = `# ${conv.title}\n\n`;
        md += `> 创建: ${conv.createdAt} | 消息数: ${conv.messages.length}\n\n---\n\n`;
        for (const m of conv.messages) {
          const label = m.role === "user" ? "👤 **用户**" : m.role === "assistant" ? "🤖 **助手**" : "⚙️ **系统**";
          md += `${label} (${m.timestamp}):\n\n${m.content}\n\n---\n\n`;
        }
        return md;
      }
      case "txt": {
        return conv.messages.map((m) => `[${m.role}] ${m.content}`).join("\n\n");
      }
      default: {
        return JSON.stringify(conv, null, 2);
      }
    }
  }

  /** 全局搜索消息 */
  searchMessages(keyword: string, limit = 20): Array<{
    conversationId: string;
    conversationTitle: string;
    message: ConversationMessage;
  }> {
    const kw = keyword.toLowerCase();
    const results: Array<{
      conversationId: string;
      conversationTitle: string;
      message: ConversationMessage;
    }> = [];

    for (const conv of this.conversations) {
      for (const msg of conv.messages) {
        if (msg.content.toLowerCase().includes(kw)) {
          results.push({
            conversationId: conv.id,
            conversationTitle: conv.title,
            message: msg,
          });
          if (results.length >= limit) return results;
        }
      }
    }

    return results;
  }

  // ==================== 统计 ====================

  getStatus(): {
    totalConversations: number;
    totalMessages: number;
    pinnedCount: number;
    archivedCount: number;
    tagDistribution: Record<string, number>;
  } {
    const tagDist: Record<string, number> = {};
    let totalMsgs = 0;

    for (const c of this.conversations) {
      totalMsgs += c.messages.length;
      for (const t of c.tags) {
        tagDist[t] = (tagDist[t] || 0) + 1;
      }
    }

    return {
      totalConversations: this.conversations.length,
      totalMessages: totalMsgs,
      pinnedCount: this.conversations.filter((c) => c.pinned).length,
      archivedCount: this.conversations.filter((c) => c.archived).length,
      tagDistribution: tagDist,
    };
  }

  // ==================== 持久化 ====================

  private load(): void {
    try {
      if (fs.existsSync(this.config.dataPath)) {
        const raw = JSON.parse(fs.readFileSync(this.config.dataPath, "utf-8"));
        this.conversations = raw.conversations || [];
      }
    } catch {
      this.conversations = [];
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(this.config.dataPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.config.dataPath, JSON.stringify({ conversations: this.conversations }));
    } catch { /* ignore */ }
  }
}
