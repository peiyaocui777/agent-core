/**
 * Skill: content-scraper — 多平台热点内容采集与分析
 *
 * 工具：
 * - scrape-trending: 热点话题采集
 * - scrape-xhs-notes: 小红书笔记搜索
 * - scrape-url: URL 内容提取
 * - analyze-content: AI 内容分析排名
 *
 * 依赖开源项目：MediaCrawler, Jina Reader, xiaohongshu-mcp
 */

import { wrapToolsAsSkill } from "../define.js";
import { createScraperTools } from "../../tools/scraper.js";

export const contentScraperSkill = wrapToolsAsSkill(
  {
    name: "content-scraper",
    version: "1.0.0",
    description: "多平台热点内容采集与智能分析，支持热点追踪、小红书搜索、URL 提取、AI 排名",
    author: "jarvis",
    category: "content",
    tags: ["scraping", "trending", "analysis", "热点", "采集"],
    triggers: ["热点", "采集", "搜索", "抓取", "trending", "爬取"],
    tools: ["scrape-trending", "scrape-xhs-notes", "scrape-url", "analyze-content"],
    permissions: ["network", "llm"],
    requires: {
      config: ["xhsApiUrl"],
    },
    enabled: true,
  },
  createScraperTools
);

export default contentScraperSkill;
