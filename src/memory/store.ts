/**
 * MemoryStore — 持久化记忆系统
 *
 * 参考 OpenClaw 的 Memory 设计：
 * - 短期记忆：当前会话上下文（内存中）
 * - 长期记忆：跨会话持久化（JSON 文件）
 * - 用户画像：偏好、风格、常用平台
 * - 发布历史：每次发布的记录
 *
 * 存储后端：JSON 文件（~/.jarvis/memory/）
 * 后续可升级为 SQLite / 向量数据库
 */

import type {
  ChatMessage,
  MemoryItem,
  UserProfile,
  PublishRecord,
  MemoryFilter,
  PublishFilter,
} from "../skills/types.js";

// ==================== 存储数据结构 ====================

interface MemoryData {
  version: number;
  profile: UserProfile;
  memories: MemoryItem[];
  publishHistory: PublishRecord[];
  updatedAt: string;
}

const DEFAULT_DATA: MemoryData = {
  version: 1,
  profile: {},
  memories: [],
  publishHistory: [],
  updatedAt: new Date().toISOString(),
};

// ==================== MemoryStore ====================

export class MemoryStore {
  private data: MemoryData;
  private storagePath: string;
  private sessionMessages: ChatMessage[] = [];
  private dirty = false;
  private autoSaveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(storagePath?: string) {
    this.storagePath = storagePath || this.getDefaultPath();
    this.data = { ...DEFAULT_DATA };
  }

  // ==================== 初始化 & 持久化 ====================

  /** 从文件加载记忆 */
  async load(): Promise<void> {
    try {
      const fs = await import("fs");
      const path = await import("path");

      // 确保目录存在
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, "utf-8");
        this.data = JSON.parse(raw) as MemoryData;
        console.log(`[Memory] 已加载记忆: ${this.data.memories.length} 条, ${this.data.publishHistory.length} 条发布记录`);
      } else {
        console.log("[Memory] 无历史记忆文件，使用默认值");
        this.data = { ...DEFAULT_DATA };
      }
    } catch (error) {
      console.error("[Memory] 加载失败，使用默认值:", error);
      this.data = { ...DEFAULT_DATA };
    }
  }

  /** 保存记忆到文件 */
  async save(): Promise<void> {
    if (!this.dirty) return;

    try {
      const fs = await import("fs");
      const path = await import("path");

      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      this.data.updatedAt = new Date().toISOString();
      fs.writeFileSync(this.storagePath, JSON.stringify(this.data, null, 2), "utf-8");
      this.dirty = false;
    } catch (error) {
      console.error("[Memory] 保存失败:", error);
    }
  }

  /** 启动自动保存（每 30 秒） */
  startAutoSave(intervalMs: number = 30000): void {
    if (this.autoSaveTimer) return;
    this.autoSaveTimer = setInterval(() => this.save(), intervalMs);
  }

  /** 停止自动保存并执行最后一次保存 */
  async stopAutoSave(): Promise<void> {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
    await this.save();
  }

  // ==================== 短期记忆（会话） ====================

  /** 添加对话消息 */
  addMessage(msg: Omit<ChatMessage, "timestamp">): void {
    this.sessionMessages.push({
      ...msg,
      timestamp: new Date(),
    });

    // 限制会话消息数量
    if (this.sessionMessages.length > 100) {
      this.sessionMessages = this.sessionMessages.slice(-80);
    }
  }

  /** 获取最近的消息 */
  getRecentMessages(limit: number = 20): ChatMessage[] {
    return this.sessionMessages.slice(-limit);
  }

  /** 获取对话上下文（供 LLM 使用） */
  getContextMessages(): Array<{ role: string; content: string }> {
    return this.sessionMessages.slice(-10).map((m) => ({
      role: m.role,
      content: m.content,
    }));
  }

  /** 清除会话消息 */
  clearSession(): void {
    this.sessionMessages = [];
  }

  // ==================== 长期记忆 ====================

  /** 记住一条信息 */
  remember(key: string, value: unknown, tags: string[] = []): void {
    const existing = this.data.memories.find((m) => m.key === key);

    if (existing) {
      existing.value = value;
      existing.tags = [...new Set([...existing.tags, ...tags])];
      existing.accessedAt = new Date();
      existing.accessCount++;
    } else {
      this.data.memories.push({
        id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        key,
        value,
        tags,
        createdAt: new Date(),
        accessedAt: new Date(),
        accessCount: 1,
      });
    }

    this.dirty = true;
  }

  /** 回忆（搜索记忆） */
  recall(query: string, limit: number = 10): MemoryItem[] {
    const q = query.toLowerCase();

    return this.data.memories
      .filter((m) => {
        const keyMatch = m.key.toLowerCase().includes(q);
        const tagMatch = m.tags.some((t) => t.toLowerCase().includes(q));
        const valueMatch = JSON.stringify(m.value).toLowerCase().includes(q);
        return keyMatch || tagMatch || valueMatch;
      })
      .sort((a, b) => {
        // 按访问频率和时间排序
        const freqScore = b.accessCount - a.accessCount;
        if (freqScore !== 0) return freqScore;
        return new Date(b.accessedAt).getTime() - new Date(a.accessedAt).getTime();
      })
      .slice(0, limit)
      .map((m) => {
        // 更新访问记录
        m.accessedAt = new Date();
        m.accessCount++;
        this.dirty = true;
        return m;
      });
  }

  /** 遗忘 */
  forget(key: string): boolean {
    const idx = this.data.memories.findIndex((m) => m.key === key);
    if (idx === -1) return false;
    this.data.memories.splice(idx, 1);
    this.dirty = true;
    return true;
  }

  /** 按条件过滤记忆 */
  filterMemories(filter: MemoryFilter): MemoryItem[] {
    let results = [...this.data.memories];

    if (filter.tags?.length) {
      results = results.filter((m) =>
        filter.tags!.some((t) => m.tags.includes(t))
      );
    }

    if (filter.startDate) {
      results = results.filter(
        (m) => new Date(m.createdAt) >= filter.startDate!
      );
    }

    if (filter.endDate) {
      results = results.filter(
        (m) => new Date(m.createdAt) <= filter.endDate!
      );
    }

    return results.slice(0, filter.limit || 50);
  }

  // ==================== 用户画像 ====================

  /** 更新画像字段 */
  updateProfile(field: string, value: unknown): void {
    if (field === "custom") {
      this.data.profile.custom = {
        ...this.data.profile.custom,
        ...(value as Record<string, unknown>),
      };
    } else {
      (this.data.profile as Record<string, unknown>)[field] = value;
    }
    this.dirty = true;
  }

  /** 获取完整画像 */
  getProfile(): UserProfile {
    return { ...this.data.profile };
  }

  /** 获取画像摘要（供 LLM System Prompt 使用） */
  getProfilePrompt(): string {
    const p = this.data.profile;
    const lines: string[] = ["## 用户画像"];

    if (p.nickname) lines.push(`昵称: ${p.nickname}`);
    if (p.preferredTopics?.length) lines.push(`偏好领域: ${p.preferredTopics.join(", ")}`);
    if (p.preferredStyle) lines.push(`写作风格: ${p.preferredStyle}`);
    if (p.platforms?.length) lines.push(`常用平台: ${p.platforms.join(", ")}`);
    if (p.publishFrequency) lines.push(`发布频率: ${p.publishFrequency}`);

    if (lines.length === 1) return ""; // 没有画像信息
    return lines.join("\n");
  }

  // ==================== 发布历史 ====================

  /** 记录一次发布 */
  logPublish(record: Omit<PublishRecord, "id" | "publishedAt">): void {
    this.data.publishHistory.push({
      ...record,
      id: `pub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      publishedAt: new Date(),
    });

    // 限制记录数量
    if (this.data.publishHistory.length > 500) {
      this.data.publishHistory = this.data.publishHistory.slice(-400);
    }

    this.dirty = true;
  }

  /** 查询发布历史 */
  getPublishHistory(filter: PublishFilter = {}): PublishRecord[] {
    let results = [...this.data.publishHistory];

    if (filter.platform) {
      results = results.filter((r) => r.platform === filter.platform);
    }

    if (filter.status) {
      results = results.filter((r) => r.status === filter.status);
    }

    if (filter.startDate) {
      results = results.filter(
        (r) => new Date(r.publishedAt) >= filter.startDate!
      );
    }

    if (filter.endDate) {
      results = results.filter(
        (r) => new Date(r.publishedAt) <= filter.endDate!
      );
    }

    // 按时间倒序
    results.sort(
      (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    );

    return results.slice(0, filter.limit || 50);
  }

  /** 获取发布统计 */
  getPublishStats(): {
    total: number;
    success: number;
    failed: number;
    byPlatform: Record<string, { total: number; success: number }>;
    recentDays: number;
  } {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const recent = this.data.publishHistory.filter(
      (r) => new Date(r.publishedAt) >= weekAgo
    );

    const byPlatform: Record<string, { total: number; success: number }> = {};
    for (const record of this.data.publishHistory) {
      if (!byPlatform[record.platform]) {
        byPlatform[record.platform] = { total: 0, success: 0 };
      }
      byPlatform[record.platform].total++;
      if (record.status === "success") {
        byPlatform[record.platform].success++;
      }
    }

    return {
      total: this.data.publishHistory.length,
      success: this.data.publishHistory.filter((r) => r.status === "success").length,
      failed: this.data.publishHistory.filter((r) => r.status === "failed").length,
      byPlatform,
      recentDays: recent.length,
    };
  }

  // ==================== 辅助 ====================

  private getDefaultPath(): string {
    const home = process.env.HOME || process.env.USERPROFILE || ".";
    return `${home}/.jarvis/memory/store.json`;
  }

  /** 导出全部数据 */
  exportData(): MemoryData {
    return JSON.parse(JSON.stringify(this.data)) as MemoryData;
  }

  /** 导入数据 */
  importData(data: MemoryData): void {
    this.data = data;
    this.dirty = true;
  }
}
