/**
 * Skill: bilibili-publisher — B站专栏/动态/视频
 *
 * 工具：
 * - bilibili-publish-article: 发布专栏文章
 * - bilibili-publish-dynamic: 发布动态
 * - bilibili-trending: 获取热门排行
 */

import { wrapToolsAsSkill } from "../define.js";
import { createBilibiliTools } from "../../tools/bilibili.js";

export const bilibiliPublisherSkill = wrapToolsAsSkill(
  {
    name: "bilibili-publisher",
    version: "1.0.0",
    description: "B站专栏文章发布、动态发布、热门排行获取",
    author: "jarvis",
    category: "publish",
    tags: ["bilibili", "B站", "哔哩哔哩", "publish", "social"],
    triggers: ["B站", "bilibili", "哔哩哔哩", "b站"],
    tools: ["bilibili-publish-article", "bilibili-publish-dynamic", "bilibili-trending"],
    permissions: ["network"],
    requires: {
      config: ["trendApiUrl"],
    },
    enabled: true,
  },
  createBilibiliTools
);

export default bilibiliPublisherSkill;
