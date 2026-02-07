/**
 * Skill: zhihu-publisher — 知乎文章/回答/热榜
 *
 * 工具：
 * - zhihu-publish-article: 发布专栏文章
 * - zhihu-answer-question: 回答问题
 * - zhihu-hot-list: 获取热榜
 * - zhihu-search-questions: 搜索问题
 */

import { wrapToolsAsSkill } from "../define.js";
import { createZhihuTools } from "../../tools/zhihu.js";

export const zhihuPublisherSkill = wrapToolsAsSkill(
  {
    name: "zhihu-publisher",
    version: "1.0.0",
    description: "知乎专栏文章发布、问题回答、热榜获取、问题搜索",
    author: "jarvis",
    category: "publish",
    tags: ["zhihu", "知乎", "publish", "social", "knowledge"],
    triggers: ["知乎", "zhihu"],
    tools: ["zhihu-publish-article", "zhihu-answer-question", "zhihu-hot-list", "zhihu-search-questions"],
    permissions: ["network"],
    requires: {
      config: ["trendApiUrl"],
    },
    enabled: true,
  },
  createZhihuTools
);

export default zhihuPublisherSkill;
