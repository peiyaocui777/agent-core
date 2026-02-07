/**
 * KnowledgeBase — 本地知识库
 *
 * 让 Agent 拥有「个人知识」：
 * 1. 导入文档（TXT/MD/JSON）
 * 2. 自动分块（Chunking）
 * 3. 向量化索引
 * 4. 语义查询 → RAG 注入
 * 5. 知识管理（增删改查）
 *
 * 参考: OpenClaw Knowledge + LobeChat Files
 */

import * as fs from "fs";
import * as path from "path";

// ==================== 类型 ====================

export interface KnowledgeDocument {
  id: string;
  title: string;
  source: string; // 文件路径或 URL
  format: "txt" | "md" | "json" | "html";
  content: string;
  chunks: KnowledgeChunk[];
  metadata: {
    createdAt: string;
    updatedAt: string;
    wordCount: number;
    chunkCount: number;
    tags?: string[];
  };
}

export interface KnowledgeChunk {
  chunkId: string;
  docId: string;
  content: string;
  vector: number[];
  position: number; // 在文档中的顺序
  metadata: {
    heading?: string;
    lineStart?: number;
    lineEnd?: number;
  };
}

export interface QueryResult {
  chunk: string;
  docId: string;
  docTitle: string;
  similarity: number;
  heading?: string;
}

export interface KnowledgeBaseConfig {
  dataPath: string;
  chunkSize: number;       // 每块最大字符数
  chunkOverlap: number;    // 块间重叠字符数
  maxDocuments: number;
  maxChunksPerDoc: number;
}

// ==================== 简易 TF-IDF 嵌入器 ====================

class ChunkEmbedder {
  private vocabulary = new Map<string, number>();
  private idf = new Map<string, number>();
  private docCount = 0;

  private tokenize(text: string): string[] {
    const tokens: string[] = [];
    const words = text.toLowerCase().match(/[a-z]+/g) || [];
    tokens.push(...words);
    const chinese = text.replace(/[a-zA-Z0-9\s\p{P}]/gu, "");
    for (let i = 0; i < chinese.length - 1; i++) {
      tokens.push(chinese.slice(i, i + 2));
    }
    for (const ch of chinese) {
      tokens.push(ch);
    }
    return tokens;
  }

  buildIndex(texts: string[]): void {
    const docFreq = new Map<string, number>();
    this.docCount = texts.length;

    for (const text of texts) {
      const uniqueTokens = new Set(this.tokenize(text));
      for (const token of uniqueTokens) {
        docFreq.set(token, (docFreq.get(token) || 0) + 1);
        if (!this.vocabulary.has(token) && this.vocabulary.size < 1024) {
          this.vocabulary.set(token, this.vocabulary.size);
        }
      }
    }

    for (const [token, freq] of docFreq) {
      this.idf.set(token, Math.log((this.docCount + 1) / (freq + 1)) + 1);
    }
  }

  embed(text: string): number[] {
    const tokens = this.tokenize(text);
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);

    const vec = new Array(this.vocabulary.size).fill(0);
    for (const [token, count] of tf) {
      const idx = this.vocabulary.get(token);
      if (idx !== undefined) {
        vec[idx] = (count / tokens.length) * (this.idf.get(token) || 1);
      }
    }

    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    if (norm > 0) for (let i = 0; i < vec.length; i++) vec[i] /= norm;
    return vec;
  }

  cosine(a: number[], b: number[]): number {
    const len = Math.min(a.length, b.length);
    let dot = 0, nA = 0, nB = 0;
    for (let i = 0; i < len; i++) {
      dot += a[i] * b[i];
      nA += a[i] * a[i];
      nB += b[i] * b[i];
    }
    const d = Math.sqrt(nA) * Math.sqrt(nB);
    return d > 0 ? dot / d : 0;
  }

  exportState(): { vocabulary: [string, number][]; idf: [string, number][]; docCount: number } {
    return {
      vocabulary: Array.from(this.vocabulary.entries()),
      idf: Array.from(this.idf.entries()),
      docCount: this.docCount,
    };
  }

  importState(data: { vocabulary: [string, number][]; idf: [string, number][]; docCount: number }): void {
    this.vocabulary = new Map(data.vocabulary);
    this.idf = new Map(data.idf);
    this.docCount = data.docCount;
  }
}

// ==================== KnowledgeBase ====================

export class KnowledgeBase {
  private config: KnowledgeBaseConfig;
  private documents: KnowledgeDocument[] = [];
  private embedder = new ChunkEmbedder();

  constructor(config?: Partial<KnowledgeBaseConfig>) {
    this.config = {
      dataPath: "/tmp/jarvis-knowledge.json",
      chunkSize: 500,
      chunkOverlap: 50,
      maxDocuments: 100,
      maxChunksPerDoc: 50,
      ...config,
    };
    this.load();
  }

  // ==================== 文档导入 ====================

  /** 从文本导入 */
  addDocument(
    title: string,
    content: string,
    options?: { format?: "txt" | "md" | "json" | "html"; tags?: string[]; source?: string }
  ): KnowledgeDocument {
    const format = options?.format || "txt";
    const cleanContent = this.preprocessContent(content, format);
    const chunks = this.chunkText(cleanContent);

    const doc: KnowledgeDocument = {
      id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title,
      source: options?.source || "manual",
      format,
      content: cleanContent,
      chunks: [],
      metadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        wordCount: cleanContent.length,
        chunkCount: chunks.length,
        tags: options?.tags,
      },
    };

    // 构建向量
    this.documents.push(doc);
    this.rebuildIndex();

    // 给 chunks 设向量
    doc.chunks = chunks.map((c, i) => ({
      chunkId: `${doc.id}-chunk-${i}`,
      docId: doc.id,
      content: c.text,
      vector: this.embedder.embed(c.text),
      position: i,
      metadata: { heading: c.heading, lineStart: c.lineStart, lineEnd: c.lineEnd },
    }));

    this.save();
    return doc;
  }

  /** 从文件导入 */
  addFromFile(filePath: string, options?: { tags?: string[] }): KnowledgeDocument | null {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const ext = path.extname(filePath).slice(1) as "txt" | "md" | "json" | "html";
      const title = path.basename(filePath, path.extname(filePath));
      return this.addDocument(title, content, { format: ext, source: filePath, tags: options?.tags });
    } catch {
      return null;
    }
  }

  /** 批量导入目录 */
  addFromDirectory(dirPath: string, options?: { extensions?: string[]; tags?: string[] }): number {
    const exts = options?.extensions || [".txt", ".md", ".json"];
    let count = 0;
    try {
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        if (exts.some((ext) => file.endsWith(ext))) {
          const result = this.addFromFile(path.join(dirPath, file), { tags: options?.tags });
          if (result) count++;
        }
      }
    } catch { /* ignore */ }
    return count;
  }

  // ==================== 查询 ====================

  /** 语义查询 */
  query(question: string, limit = 5): QueryResult[] {
    const allChunks = this.documents.flatMap((d) => d.chunks);
    if (allChunks.length === 0) return [];

    const qVec = this.embedder.embed(question);

    const results: QueryResult[] = allChunks
      .map((chunk) => {
        const doc = this.documents.find((d) => d.id === chunk.docId);
        return {
          chunk: chunk.content,
          docId: chunk.docId,
          docTitle: doc?.title || "Unknown",
          similarity: this.embedder.cosine(qVec, chunk.vector),
          heading: chunk.metadata.heading,
        };
      })
      .filter((r) => r.similarity > 0.05)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return results;
  }

  /** 构建 RAG 上下文 */
  buildContext(question: string, maxTokens = 1500): string {
    const results = this.query(question, 8);
    let context = "";
    let tokens = 0;

    for (const r of results) {
      const chunk = `[${r.docTitle}${r.heading ? ` > ${r.heading}` : ""}]\n${r.chunk}`;
      const est = Math.ceil(chunk.length / 2);
      if (tokens + est > maxTokens) break;
      context += chunk + "\n\n";
      tokens += est;
    }

    return context.trim();
  }

  // ==================== 管理 ====================

  /** 删除文档 */
  removeDocument(docId: string): boolean {
    const idx = this.documents.findIndex((d) => d.id === docId);
    if (idx < 0) return false;
    this.documents.splice(idx, 1);
    this.rebuildIndex();
    this.save();
    return true;
  }

  /** 列出所有文档 */
  listDocuments(): Array<{
    id: string;
    title: string;
    source: string;
    wordCount: number;
    chunkCount: number;
    tags?: string[];
    createdAt: string;
  }> {
    return this.documents.map((d) => ({
      id: d.id,
      title: d.title,
      source: d.source,
      wordCount: d.metadata.wordCount,
      chunkCount: d.metadata.chunkCount,
      tags: d.metadata.tags,
      createdAt: d.metadata.createdAt,
    }));
  }

  /** 按标签搜索文档 */
  searchByTag(tag: string): KnowledgeDocument[] {
    return this.documents.filter((d) => d.metadata.tags?.includes(tag));
  }

  /** 状态 */
  getStatus(): {
    totalDocuments: number;
    totalChunks: number;
    totalWords: number;
    vocabularySize: number;
    formats: Record<string, number>;
  } {
    const formats: Record<string, number> = {};
    let totalChunks = 0;
    let totalWords = 0;
    for (const d of this.documents) {
      formats[d.format] = (formats[d.format] || 0) + 1;
      totalChunks += d.chunks.length;
      totalWords += d.metadata.wordCount;
    }
    return {
      totalDocuments: this.documents.length,
      totalChunks,
      totalWords,
      vocabularySize: this.embedder.exportState().vocabulary.length,
      formats,
    };
  }

  // ==================== 内部 ====================

  private preprocessContent(content: string, format: string): string {
    switch (format) {
      case "html":
        return content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      case "json":
        try {
          const obj = JSON.parse(content);
          return JSON.stringify(obj, null, 2);
        } catch {
          return content;
        }
      default:
        return content;
    }
  }

  private chunkText(text: string): Array<{ text: string; heading?: string; lineStart: number; lineEnd: number }> {
    const lines = text.split("\n");
    const chunks: Array<{ text: string; heading?: string; lineStart: number; lineEnd: number }> = [];
    let currentChunk = "";
    let currentHeading = "";
    let chunkLineStart = 0;
    let lineIdx = 0;

    for (const line of lines) {
      // Markdown 标题检测
      if (/^#{1,4}\s/.test(line)) {
        // 保存当前 chunk
        if (currentChunk.trim()) {
          chunks.push({
            text: currentChunk.trim(),
            heading: currentHeading || undefined,
            lineStart: chunkLineStart,
            lineEnd: lineIdx - 1,
          });
        }
        currentHeading = line.replace(/^#+\s*/, "");
        currentChunk = line + "\n";
        chunkLineStart = lineIdx;
      } else {
        currentChunk += line + "\n";
        if (currentChunk.length >= this.config.chunkSize) {
          chunks.push({
            text: currentChunk.trim(),
            heading: currentHeading || undefined,
            lineStart: chunkLineStart,
            lineEnd: lineIdx,
          });
          // 重叠
          const overlap = currentChunk.slice(-this.config.chunkOverlap);
          currentChunk = overlap;
          chunkLineStart = lineIdx;
        }
      }
      lineIdx++;
    }

    // 最后一块
    if (currentChunk.trim()) {
      chunks.push({
        text: currentChunk.trim(),
        heading: currentHeading || undefined,
        lineStart: chunkLineStart,
        lineEnd: lineIdx - 1,
      });
    }

    return chunks.slice(0, this.config.maxChunksPerDoc);
  }

  private rebuildIndex(): void {
    const allTexts = this.documents.flatMap((d) =>
      d.chunks.length > 0 ? d.chunks.map((c) => c.content) : [d.content]
    );
    if (allTexts.length > 0) {
      this.embedder.buildIndex(allTexts);
    }
  }

  // ==================== 持久化 ====================

  private load(): void {
    try {
      if (fs.existsSync(this.config.dataPath)) {
        const raw = JSON.parse(fs.readFileSync(this.config.dataPath, "utf-8"));
        this.documents = raw.documents || [];
        if (raw.embedderState) {
          this.embedder.importState(raw.embedderState);
        }
      }
    } catch {
      this.documents = [];
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(this.config.dataPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        this.config.dataPath,
        JSON.stringify({
          documents: this.documents,
          embedderState: this.embedder.exportState(),
        })
      );
    } catch { /* ignore */ }
  }
}
