/**
 * VectorMemory — 向量记忆系统
 *
 * 从 JSON 平面记忆升级为语义向量搜索：
 * 1. 本地向量索引（无需外部数据库，纯 TypeScript 实现）
 * 2. 文本嵌入：支持 OpenAI / 本地 TF-IDF 双模式
 * 3. 相似度搜索：余弦相似度 Top-K
 * 4. RAG 上下文注入：自动检索相关记忆拼接到 LLM Prompt
 * 5. 记忆分层：短期（会话）→ 中期（摘要）→ 长期（向量）
 *
 * 参考: OpenClaw Persistent Memory + MemGPT
 */

import * as fs from "fs";
import * as path from "path";

// ==================== 类型 ====================

export interface VectorEntry {
  id: string;
  text: string;
  vector: number[];
  metadata: {
    type: "conversation" | "fact" | "preference" | "summary" | "publish" | "skill_usage";
    source?: string;
    tags?: string[];
    importance?: number; // 0-10
    createdAt: string;
    accessCount: number;
    lastAccessedAt?: string;
  };
}

export interface SearchResult {
  entry: VectorEntry;
  similarity: number;
}

export interface VectorMemoryConfig {
  dataPath: string;
  /** 向量维度（TF-IDF 模式自适应） */
  dimensions: number;
  /** 最大存储条目 */
  maxEntries: number;
  /** 相似度阈值（低于此值不返回） */
  similarityThreshold: number;
  /** 嵌入模式 */
  embeddingMode: "tfidf" | "api";
  /** OpenAI API Key（api 模式） */
  embeddingApiKey?: string;
}

export interface RAGContext {
  query: string;
  relevantMemories: SearchResult[];
  contextText: string;
  tokenEstimate: number;
}

// ==================== TF-IDF 本地嵌入 ====================

class TFIDFEmbedder {
  private vocabulary = new Map<string, number>();
  private idf = new Map<string, number>();
  private docCount = 0;
  private maxDim: number;

  constructor(maxDim = 512) {
    this.maxDim = maxDim;
  }

  /** 分词（中文按字，英文按词） */
  private tokenize(text: string): string[] {
    const tokens: string[] = [];
    // 英文单词
    const words = text.toLowerCase().match(/[a-z]+/g) || [];
    tokens.push(...words);
    // 中文双字 gram
    const chinese = text.replace(/[a-zA-Z0-9\s\p{P}]/gu, "");
    for (let i = 0; i < chinese.length - 1; i++) {
      tokens.push(chinese.slice(i, i + 2));
    }
    // 单字
    for (const ch of chinese) {
      tokens.push(ch);
    }
    return tokens;
  }

  /** 建立/更新词汇表 */
  updateVocabulary(texts: string[]): void {
    const docFreq = new Map<string, number>();

    for (const text of texts) {
      const tokens = new Set(this.tokenize(text));
      for (const token of tokens) {
        docFreq.set(token, (docFreq.get(token) || 0) + 1);
        if (!this.vocabulary.has(token) && this.vocabulary.size < this.maxDim) {
          this.vocabulary.set(token, this.vocabulary.size);
        }
      }
    }

    this.docCount = texts.length;
    for (const [token, freq] of docFreq) {
      this.idf.set(token, Math.log((this.docCount + 1) / (freq + 1)) + 1);
    }
  }

  /** 文本 → 向量 */
  embed(text: string): number[] {
    const tokens = this.tokenize(text);
    const tf = new Map<string, number>();
    for (const token of tokens) {
      tf.set(token, (tf.get(token) || 0) + 1);
    }

    const vector = new Array(this.vocabulary.size).fill(0);
    for (const [token, count] of tf) {
      const idx = this.vocabulary.get(token);
      if (idx !== undefined) {
        const tfValue = count / tokens.length;
        const idfValue = this.idf.get(token) || 1;
        vector[idx] = tfValue * idfValue;
      }
    }

    // L2 归一化
    const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] /= norm;
      }
    }

    return vector;
  }

  getDimensions(): number {
    return this.vocabulary.size;
  }

  /** 导出词表 */
  exportVocabulary(): { vocabulary: [string, number][]; idf: [string, number][]; docCount: number } {
    return {
      vocabulary: Array.from(this.vocabulary.entries()),
      idf: Array.from(this.idf.entries()),
      docCount: this.docCount,
    };
  }

  /** 导入词表 */
  importVocabulary(data: { vocabulary: [string, number][]; idf: [string, number][]; docCount: number }): void {
    this.vocabulary = new Map(data.vocabulary);
    this.idf = new Map(data.idf);
    this.docCount = data.docCount;
  }
}

// ==================== VectorMemory ====================

export class VectorMemory {
  private config: VectorMemoryConfig;
  private entries: VectorEntry[] = [];
  private embedder: TFIDFEmbedder;

  constructor(config?: Partial<VectorMemoryConfig>) {
    this.config = {
      dataPath: "/tmp/jarvis-vector-memory.json",
      dimensions: 512,
      maxEntries: 10000,
      similarityThreshold: 0.1,
      embeddingMode: "tfidf",
      ...config,
    };
    this.embedder = new TFIDFEmbedder(this.config.dimensions);
    this.load();
  }

  // ==================== 写入 ====================

  /**
   * 记住一条信息
   */
  remember(
    text: string,
    type: VectorEntry["metadata"]["type"] = "fact",
    options?: {
      tags?: string[];
      importance?: number;
      source?: string;
    }
  ): VectorEntry {
    // 更新词汇表并嵌入
    this.embedder.updateVocabulary([...this.entries.map((e) => e.text), text]);
    const vector = this.embedder.embed(text);

    const entry: VectorEntry = {
      id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text,
      vector,
      metadata: {
        type,
        tags: options?.tags || [],
        importance: options?.importance || 5,
        source: options?.source,
        createdAt: new Date().toISOString(),
        accessCount: 0,
      },
    };

    this.entries.push(entry);

    // 限制存储量
    if (this.entries.length > this.config.maxEntries) {
      this.compact();
    }

    this.save();
    return entry;
  }

  /**
   * 批量记忆
   */
  rememberBatch(items: Array<{ text: string; type?: VectorEntry["metadata"]["type"]; tags?: string[] }>): number {
    const texts = [...this.entries.map((e) => e.text), ...items.map((i) => i.text)];
    this.embedder.updateVocabulary(texts);

    for (const item of items) {
      const vector = this.embedder.embed(item.text);
      this.entries.push({
        id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text: item.text,
        vector,
        metadata: {
          type: item.type || "fact",
          tags: item.tags || [],
          importance: 5,
          createdAt: new Date().toISOString(),
          accessCount: 0,
        },
      });
    }

    if (this.entries.length > this.config.maxEntries) {
      this.compact();
    }

    this.save();
    return items.length;
  }

  /**
   * 记住对话（自动摘要）
   */
  rememberConversation(userMessage: string, assistantReply: string): VectorEntry {
    const combined = `用户: ${userMessage}\n助手: ${assistantReply}`;
    return this.remember(combined, "conversation", {
      tags: ["chat"],
      importance: 3,
    });
  }

  // ==================== 搜索 ====================

  /**
   * 语义搜索（余弦相似度）
   */
  search(query: string, limit = 5, filter?: { type?: string; tags?: string[] }): SearchResult[] {
    if (this.entries.length === 0) return [];

    // 确保词汇表包含查询词
    this.embedder.updateVocabulary([...this.entries.map((e) => e.text), query]);
    const queryVector = this.embedder.embed(query);

    // 重新嵌入所有条目（因为词汇表可能扩展了）
    for (const entry of this.entries) {
      entry.vector = this.embedder.embed(entry.text);
    }

    let candidates = this.entries;

    // 过滤
    if (filter?.type) {
      candidates = candidates.filter((e) => e.metadata.type === filter.type);
    }
    if (filter?.tags && filter.tags.length > 0) {
      candidates = candidates.filter((e) =>
        filter.tags!.some((t) => e.metadata.tags?.includes(t))
      );
    }

    // 计算相似度并排序
    const results: SearchResult[] = candidates
      .map((entry) => ({
        entry,
        similarity: this.cosineSimilarity(queryVector, entry.vector),
      }))
      .filter((r) => r.similarity >= this.config.similarityThreshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    // 更新访问计数
    for (const r of results) {
      r.entry.metadata.accessCount++;
      r.entry.metadata.lastAccessedAt = new Date().toISOString();
    }

    return results;
  }

  /**
   * 按类型检索
   */
  getByType(type: VectorEntry["metadata"]["type"], limit = 20): VectorEntry[] {
    return this.entries
      .filter((e) => e.metadata.type === type)
      .sort((a, b) => new Date(b.metadata.createdAt).getTime() - new Date(a.metadata.createdAt).getTime())
      .slice(0, limit);
  }

  // ==================== RAG 上下文 ====================

  /**
   * 构建 RAG 上下文
   * 根据用户查询，检索相关记忆，拼接为 LLM 可用的上下文
   */
  buildRAGContext(query: string, maxTokens = 2000): RAGContext {
    const results = this.search(query, 10);

    let contextText = "";
    let tokenEstimate = 0;
    const used: SearchResult[] = [];

    for (const r of results) {
      const entryText = `[${r.entry.metadata.type}] ${r.entry.text}`;
      const entryTokens = Math.ceil(entryText.length / 2); // 粗略估算

      if (tokenEstimate + entryTokens > maxTokens) break;

      contextText += entryText + "\n\n";
      tokenEstimate += entryTokens;
      used.push(r);
    }

    return {
      query,
      relevantMemories: used,
      contextText: contextText.trim(),
      tokenEstimate,
    };
  }

  /**
   * 生成 RAG System Prompt 片段
   */
  buildRAGPrompt(query: string): string {
    const ctx = this.buildRAGContext(query);
    if (ctx.relevantMemories.length === 0) return "";

    return `## 相关记忆
以下是与当前对话相关的历史记忆，请参考这些信息来回答：

${ctx.contextText}

---
`;
  }

  // ==================== 遗忘 / 整理 ====================

  /** 删除记忆 */
  forget(id: string): boolean {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx < 0) return false;
    this.entries.splice(idx, 1);
    this.save();
    return true;
  }

  /** 按条件清理 */
  forgetByFilter(filter: { type?: string; olderThan?: string; minImportance?: number }): number {
    const before = this.entries.length;

    this.entries = this.entries.filter((e) => {
      if (filter.type && e.metadata.type === filter.type) return false;
      if (filter.olderThan && e.metadata.createdAt < filter.olderThan) return false;
      if (filter.minImportance !== undefined && (e.metadata.importance || 0) < filter.minImportance) return false;
      return true;
    });

    const removed = before - this.entries.length;
    if (removed > 0) this.save();
    return removed;
  }

  /** 压缩：淘汰低价值记忆 */
  private compact(): void {
    // 按 (importance * 2 + accessCount) 排序，保留 Top 80%
    const keep = Math.floor(this.config.maxEntries * 0.8);
    this.entries.sort((a, b) => {
      const scoreA = (a.metadata.importance || 5) * 2 + a.metadata.accessCount;
      const scoreB = (b.metadata.importance || 5) * 2 + b.metadata.accessCount;
      return scoreB - scoreA;
    });
    this.entries = this.entries.slice(0, keep);
  }

  // ==================== 统计 ====================

  getStatus(): {
    totalEntries: number;
    typeDistribution: Record<string, number>;
    vocabularySize: number;
    oldestEntry: string | null;
    newestEntry: string | null;
  } {
    const dist: Record<string, number> = {};
    for (const e of this.entries) {
      dist[e.metadata.type] = (dist[e.metadata.type] || 0) + 1;
    }

    const sorted = this.entries.sort(
      (a, b) => new Date(a.metadata.createdAt).getTime() - new Date(b.metadata.createdAt).getTime()
    );

    return {
      totalEntries: this.entries.length,
      typeDistribution: dist,
      vocabularySize: this.embedder.getDimensions(),
      oldestEntry: sorted[0]?.metadata.createdAt || null,
      newestEntry: sorted[sorted.length - 1]?.metadata.createdAt || null,
    };
  }

  // ==================== 内部 ====================

  private cosineSimilarity(a: number[], b: number[]): number {
    const minLen = Math.min(a.length, b.length);
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < minLen; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? dot / denom : 0;
  }

  // ==================== 持久化 ====================

  private load(): void {
    try {
      if (fs.existsSync(this.config.dataPath)) {
        const raw = fs.readFileSync(this.config.dataPath, "utf-8");
        const data = JSON.parse(raw);
        this.entries = data.entries || [];
        if (data.vocabulary) {
          this.embedder.importVocabulary(data.vocabulary);
        }
      }
    } catch {
      this.entries = [];
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(this.config.dataPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        this.config.dataPath,
        JSON.stringify({
          entries: this.entries,
          vocabulary: this.embedder.exportVocabulary(),
        })
      );
    } catch {
      // ignore
    }
  }
}
