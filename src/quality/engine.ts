/**
 * Quality Engine — 内容质量引擎
 *
 * 功能：
 * 1. 多维度质量评分（可读性/原创性/互动/价值/结构/表达/合规）
 * 2. 原创性检测（重复片段 + AI 生成概率）
 * 3. 自动优化建议 + 内容改写
 * 4. 平台适配优化
 */

import type {
  QualityEngineConfig,
  QualityScoreResult,
  DimensionScore,
  QualityDimension,
  Recommendation,
  OriginalityResult,
  SuspiciousFragment,
  OptimizeOptions,
  OptimizeResult,
} from "./types.js";

// ==================== 默认配置 ====================

const DEFAULT_CONFIG: QualityEngineConfig = {
  originalityThreshold: 70,
  aiDetectionThreshold: 0.8,
  minPublishScore: 60,
};

// ==================== Quality Engine ====================

export class QualityEngine {
  private config: QualityEngineConfig;

  constructor(config?: Partial<QualityEngineConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ==================== 1. 质量评分 ====================

  /**
   * 多维度质量评分
   */
  scoreContent(content: string, title: string): QualityScoreResult {
    const dimensions: DimensionScore[] = [
      this.scoreReadability(content),
      this.scoreOriginality(content),
      this.scoreEngagement(content, title),
      this.scoreValue(content),
      this.scoreStructure(content),
      this.scoreExpression(content),
      this.scoreCompliance(content),
    ];

    // 加权总分
    const weights: Record<QualityDimension, number> = {
      readability: 15,
      originality: 20,
      engagement: 20,
      value: 15,
      structure: 10,
      expression: 10,
      compliance: 10,
    };

    const totalWeight = Object.values(weights).reduce((s, w) => s + w, 0);
    const totalScore = Math.round(
      dimensions.reduce(
        (s, d) => s + (d.score * (weights[d.dimension] || 10)) / totalWeight,
        0
      )
    );

    const grade =
      totalScore >= 90 ? "S" : totalScore >= 75 ? "A" : totalScore >= 60 ? "B" : totalScore >= 40 ? "C" : "D";

    // 生成建议
    const recommendations = this.generateRecommendations(dimensions);

    // 综合评语
    const summary = this.generateSummary(totalScore, grade, dimensions);

    return {
      totalScore,
      grade,
      dimensions,
      summary,
      recommendations,
      scoredAt: new Date().toISOString(),
    };
  }

  // ==================== 2. 原创检测 ====================

  /**
   * 原创性检测
   */
  checkOriginality(content: string): OriginalityResult {
    const fragments: SuspiciousFragment[] = [];

    // 检测常见 AI 套话
    const aiPatterns = [
      { pattern: "在当今社会", reason: "AI 常用开头套话" },
      { pattern: "随着科技的发展", reason: "AI 常用开头套话" },
      { pattern: "综上所述", reason: "AI 常用总结套话" },
      { pattern: "总而言之", reason: "AI 常用总结套话" },
      { pattern: "值得注意的是", reason: "AI 常用过渡句" },
      { pattern: "首先.*其次.*最后", reason: "AI 典型三段式结构" },
      { pattern: "不仅.*而且.*还", reason: "AI 常用递进结构" },
      { pattern: "一方面.*另一方面", reason: "AI 常用对比结构" },
      { pattern: "众所周知", reason: "AI 常用引入词" },
      { pattern: "毋庸置疑", reason: "AI 常用强调词" },
    ];

    let aiSignalCount = 0;
    for (const { pattern, reason } of aiPatterns) {
      const regex = new RegExp(pattern, "g");
      const match = regex.exec(content);
      if (match) {
        aiSignalCount++;
        fragments.push({
          text: match[0],
          startIndex: match.index,
          endIndex: match.index + match[0].length,
          reason,
          similarity: 0.8,
        });
      }
    }

    // 检测重复句式
    const sentences = content.split(/[。！？\n]+/).filter((s) => s.trim().length > 5);
    const sentenceStarters = sentences.map((s) => s.trim().slice(0, 4));
    const starterCounts = new Map<string, number>();
    for (const starter of sentenceStarters) {
      starterCounts.set(starter, (starterCounts.get(starter) || 0) + 1);
    }
    for (const [starter, count] of starterCounts) {
      if (count >= 3) {
        fragments.push({
          text: `"${starter}..." 重复 ${count} 次`,
          startIndex: 0,
          endIndex: 0,
          reason: "句式重复，缺乏变化",
          similarity: 0.6,
        });
      }
    }

    // 检测段落长度一致性（AI 生成的段落往往长度相近）
    const paragraphs = content.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
    if (paragraphs.length >= 3) {
      const lengths = paragraphs.map((p) => p.length);
      const avg = lengths.reduce((s, l) => s + l, 0) / lengths.length;
      const variance = lengths.reduce((s, l) => s + Math.pow(l - avg, 2), 0) / lengths.length;
      const cv = Math.sqrt(variance) / avg; // 变异系数
      if (cv < 0.15) {
        // 段落长度过于一致
        aiSignalCount++;
      }
    }

    // 计算 AI 生成概率
    const aiGeneratedProbability = Math.min(1, aiSignalCount / 5);

    // 原创度评分
    const originalityScore = Math.max(
      0,
      100 - aiSignalCount * 15 - fragments.length * 5
    );

    return {
      originalityScore: Math.max(0, Math.min(100, originalityScore)),
      aiGeneratedProbability,
      suspiciousFragments: fragments,
      passed: originalityScore >= this.config.originalityThreshold,
    };
  }

  // ==================== 3. 自动优化 ====================

  /**
   * 生成优化建议和改写方案
   * （不使用 LLM 的轻量级版本，基于规则优化）
   */
  optimizeContent(
    content: string,
    title: string,
    options: OptimizeOptions = {}
  ): OptimizeResult {
    const beforeScore = this.scoreContent(content, title).totalScore;
    let optimizedTitle = title;
    let optimizedContent = content;
    const changes: string[] = [];

    // 1. 标题优化
    if (title.length < 10) {
      optimizedTitle = `${title} | 超实用干货分享`;
      changes.push("标题过短，已补充吸引力后缀");
    }

    // 2. 添加 Emoji（如果需要）
    if (options.addEmoji !== false && !/[\u{1F600}-\u{1F64F}]/u.test(optimizedContent)) {
      const emojiMap: Record<string, string> = {
        "干货": "📚",
        "推荐": "👍",
        "注意": "⚠️",
        "总结": "📝",
        "重点": "🔥",
        "技巧": "💡",
        "步骤": "📋",
      };

      for (const [word, emoji] of Object.entries(emojiMap)) {
        if (optimizedContent.includes(word)) {
          optimizedContent = optimizedContent.replace(word, `${emoji} ${word}`);
          changes.push(`在"${word}"前添加了 ${emoji}`);
          break; // 只加一个避免过度
        }
      }

      if (changes.length === 0) {
        optimizedContent = `✨ ${optimizedContent}`;
        changes.push("在开头添加了吸引力 Emoji");
      }
    }

    // 3. 添加话题标签
    if (options.addHashtags !== false) {
      const hashtagCount = (optimizedContent.match(/#[^\s#]+/g) || []).length;
      if (hashtagCount < 3 && options.targetKeywords?.length) {
        const newTags = options.targetKeywords
          .slice(0, 5 - hashtagCount)
          .map((kw) => `#${kw}`)
          .join(" ");
        optimizedContent = `${optimizedContent}\n\n${newTags}`;
        changes.push(`添加了 ${5 - hashtagCount} 个话题标签`);
      }
    }

    // 4. 添加 CTA（互动引导）
    const ctaPatterns = ["点赞", "关注", "收藏", "转发", "评论"];
    const hasCTA = ctaPatterns.some((p) => optimizedContent.includes(p));
    if (!hasCTA) {
      const ctas = [
        "\n\n💬 觉得有帮助的话，点赞收藏不迷路～",
        "\n\n🔥 你怎么看？欢迎留言讨论！",
        "\n\n👉 关注我，每天分享实用干货！",
      ];
      optimizedContent += ctas[Math.floor(Math.random() * ctas.length)];
      changes.push("添加了互动引导 (CTA)");
    }

    // 5. 段落优化（过长段落拆分）
    const paragraphs = optimizedContent.split("\n");
    const optimizedParagraphs = paragraphs.map((p) => {
      if (p.length > 200) {
        // 在句号处拆分
        const mid = p.indexOf("。", Math.floor(p.length / 2));
        if (mid > 0) {
          changes.push("拆分了过长段落");
          return p.slice(0, mid + 1) + "\n\n" + p.slice(mid + 1);
        }
      }
      return p;
    });
    optimizedContent = optimizedParagraphs.join("\n");

    const afterScore = this.scoreContent(optimizedContent, optimizedTitle).totalScore;

    return {
      optimizedTitle,
      optimizedContent,
      changes,
      beforeScore,
      afterScore,
    };
  }

  // ==================== 综合检查 ====================

  /**
   * 发布前综合质量检查
   * 返回是否达到发布标准
   */
  prePublishQualityCheck(
    content: string,
    title: string
  ): {
    ready: boolean;
    qualityScore: QualityScoreResult;
    originality: OriginalityResult;
    reasons: string[];
  } {
    const qualityScore = this.scoreContent(content, title);
    const originality = this.checkOriginality(content);
    const reasons: string[] = [];

    if (qualityScore.totalScore < this.config.minPublishScore) {
      reasons.push(
        `质量评分 ${qualityScore.totalScore} 低于最低标准 ${this.config.minPublishScore}`
      );
    }

    if (!originality.passed) {
      reasons.push(
        `原创度 ${originality.originalityScore}% 低于阈值 ${this.config.originalityThreshold}%`
      );
    }

    if (originality.aiGeneratedProbability > this.config.aiDetectionThreshold) {
      reasons.push(
        `AI 生成概率 ${(originality.aiGeneratedProbability * 100).toFixed(0)}% 过高`
      );
    }

    return {
      ready: reasons.length === 0,
      qualityScore,
      originality,
      reasons,
    };
  }

  /** 获取配置 */
  getConfig(): QualityEngineConfig {
    return { ...this.config };
  }

  // ==================== 维度评分实现 ====================

  private scoreReadability(content: string): DimensionScore {
    const sentences = content.split(/[。！？\n]+/).filter((s) => s.trim().length > 0);
    const avgSentenceLen = sentences.length > 0
      ? sentences.reduce((s, sen) => s + sen.length, 0) / sentences.length
      : 0;

    // 理想句子长度 15-40 字
    let score = 100;
    if (avgSentenceLen < 10) score -= 30;
    if (avgSentenceLen > 50) score -= 30;
    if (avgSentenceLen > 80) score -= 20;

    // 检测段落
    const paragraphs = content.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
    if (paragraphs.length < 2) score -= 20;

    score = Math.max(0, Math.min(100, score));

    return {
      dimension: "readability",
      score,
      label: "可读性",
      feedback: score >= 80 ? "段落清晰，句式适中" : score >= 60 ? "可读性一般，建议调整句式长度" : "可读性较差，建议分段和缩短句子",
      suggestions: score < 80 ? ["建议每段 3-5 句话", "长句拆为短句"] : [],
    };
  }

  private scoreOriginality(content: string): DimensionScore {
    const result = this.checkOriginality(content);
    return {
      dimension: "originality",
      score: result.originalityScore,
      label: "原创性",
      feedback: result.originalityScore >= 80
        ? "内容原创度高"
        : result.originalityScore >= 60
          ? "存在部分套话，建议增加个人观点"
          : "原创度不足，建议大幅修改",
      suggestions: result.suspiciousFragments.map((f) => f.reason),
    };
  }

  private scoreEngagement(content: string, title: string): DimensionScore {
    let score = 50; // 基准分

    // 标题吸引力
    const titleHooks = ["如何", "为什么", "必看", "干货", "秘密", "技巧", "方法", "指南", "深度", "真相"];
    if (titleHooks.some((h) => title.includes(h))) score += 10;

    // 数字标题
    if (/\d+/.test(title)) score += 10;

    // 问句
    if (/？/.test(content)) score += 5;

    // 互动引导
    const ctaWords = ["点赞", "关注", "收藏", "转发", "评论", "留言"];
    if (ctaWords.some((w) => content.includes(w))) score += 15;

    // Emoji
    const emojiCount = (content.match(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}]/gu) || []).length;
    if (emojiCount >= 3) score += 10;
    else if (emojiCount >= 1) score += 5;

    score = Math.max(0, Math.min(100, score));

    return {
      dimension: "engagement",
      score,
      label: "互动潜力",
      feedback: score >= 80 ? "互动引导充分" : score >= 60 ? "互动引导一般" : "缺乏互动引导",
      suggestions: score < 80
        ? ["添加吸引力标题", "增加互动引导 (CTA)", "使用 Emoji 增加趣味"]
        : [],
    };
  }

  private scoreValue(content: string): DimensionScore {
    let score = 50;

    // 内容深度（字数）
    if (content.length > 500) score += 10;
    if (content.length > 1000) score += 10;

    // 包含具体数据/数字
    const numbers = content.match(/\d+/g) || [];
    if (numbers.length >= 3) score += 10;

    // 包含列表/步骤
    if (/[1-9][.、]|①|②|③|第[一二三四五]/.test(content)) score += 10;

    // 包含实操关键词
    const actionWords = ["步骤", "方法", "技巧", "工具", "教程", "实操", "攻略", "避坑"];
    if (actionWords.some((w) => content.includes(w))) score += 10;

    score = Math.max(0, Math.min(100, score));

    return {
      dimension: "value",
      score,
      label: "内容价值",
      feedback: score >= 80 ? "信息量充足，干货满满" : score >= 60 ? "有一定价值，建议增加实操内容" : "内容过于空泛",
      suggestions: score < 80
        ? ["添加具体数据和案例", "增加实操步骤", "列举工具或资源"]
        : [],
    };
  }

  private scoreStructure(content: string): DimensionScore {
    const paragraphs = content.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
    let score = 50;

    // 段落数量
    if (paragraphs.length >= 3 && paragraphs.length <= 10) score += 20;
    else if (paragraphs.length >= 2) score += 10;

    // 有小标题/序号
    if (/^#+\s|^[1-9][.、]|^[一二三四五六七八九十]/m.test(content)) score += 15;

    // 有开头和结尾
    if (content.length > 200) {
      const lastParagraph = paragraphs[paragraphs.length - 1] || "";
      if (lastParagraph.includes("总结") || lastParagraph.includes("最后") || lastParagraph.includes("希望")) {
        score += 15;
      }
    }

    score = Math.max(0, Math.min(100, score));

    return {
      dimension: "structure",
      score,
      label: "结构完整性",
      feedback: score >= 80 ? "结构清晰完整" : score >= 60 ? "结构基本完整" : "缺乏组织结构",
      suggestions: score < 80
        ? ["使用小标题分段", "添加开头引入和结尾总结", "使用序号列表"]
        : [],
    };
  }

  private scoreExpression(content: string): DimensionScore {
    let score = 60;

    // 词汇丰富度（简单估算：不同的两字词数量）
    const twoGrams = new Set<string>();
    for (let i = 0; i < content.length - 1; i++) {
      twoGrams.add(content.slice(i, i + 2));
    }
    const richness = content.length > 0 ? twoGrams.size / content.length : 0;
    if (richness > 0.6) score += 15;
    else if (richness > 0.4) score += 5;

    // 修辞手法（比喻、排比等）
    if (/就像|好比|仿佛|犹如/.test(content)) score += 10;
    // 排比
    const lines = content.split("\n").filter((l) => l.trim());
    const similarStarts = lines.filter((l, i) =>
      i > 0 && l.trim().slice(0, 2) === lines[i - 1].trim().slice(0, 2)
    );
    if (similarStarts.length >= 2) score += 5;

    score = Math.max(0, Math.min(100, score));

    return {
      dimension: "expression",
      score,
      label: "表达力",
      feedback: score >= 80 ? "表达生动有力" : score >= 60 ? "表达中规中矩" : "表达单调",
      suggestions: score < 80
        ? ["使用比喻增加生动性", "变换句式避免单调", "适当使用感叹和反问"]
        : [],
    };
  }

  private scoreCompliance(content: string): DimensionScore {
    let score = 100;
    const issues: string[] = [];

    // 检测敏感内容（轻量级，不替代 SafetyEngine）
    const warningWords = ["赚钱", "躺赚", "副业", "变现", "引流", "私域"];
    const found = warningWords.filter((w) => content.includes(w));
    if (found.length > 0) {
      score -= found.length * 10;
      issues.push(`包含敏感营销词: ${found.join(", ")}`);
    }

    // 外链
    const urls = content.match(/https?:\/\//g) || [];
    if (urls.length > 2) {
      score -= 15;
      issues.push("外链过多");
    }

    score = Math.max(0, Math.min(100, score));

    return {
      dimension: "compliance",
      score,
      label: "合规性",
      feedback: score >= 80 ? "内容合规" : "存在合规风险",
      suggestions: issues,
    };
  }

  // ==================== 辅助方法 ====================

  private generateRecommendations(dimensions: DimensionScore[]): Recommendation[] {
    const recs: Recommendation[] = [];

    for (const dim of dimensions) {
      if (dim.score < 80) {
        for (const suggestion of dim.suggestions) {
          recs.push({
            priority: dim.score < 50 ? "high" : dim.score < 70 ? "medium" : "low",
            dimension: dim.dimension,
            action: suggestion,
            reason: dim.feedback,
          });
        }
      }
    }

    return recs.sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.priority] - order[b.priority];
    });
  }

  private generateSummary(
    totalScore: number,
    grade: string,
    dimensions: DimensionScore[]
  ): string {
    const best = dimensions.sort((a, b) => b.score - a.score)[0];
    const worst = dimensions.sort((a, b) => a.score - b.score)[0];

    if (totalScore >= 90) {
      return `内容质量优秀 (${grade} 级, ${totalScore}分)！${best.label}表现突出。`;
    }
    if (totalScore >= 75) {
      return `内容质量良好 (${grade} 级, ${totalScore}分)，${best.label}是亮点，${worst.label}可以进一步优化。`;
    }
    if (totalScore >= 60) {
      return `内容质量中等 (${grade} 级, ${totalScore}分)，建议重点优化${worst.label} (${worst.score}分)。`;
    }
    return `内容质量偏低 (${grade} 级, ${totalScore}分)，建议从${worst.label}和结构入手全面优化。`;
  }
}
