/**
 * Skill: weibo-publisher — 微博发布与热搜
 *
 * 工具：
 * - weibo-publish: 发微博
 * - weibo-hot-search: 获取热搜
 * - weibo-repost: 转发微博
 */

import { wrapToolsAsSkill } from "../define.js";
import { createWeiboTools } from "../../tools/weibo.js";

export const weiboPublisherSkill = wrapToolsAsSkill(
  {
    name: "weibo-publisher",
    version: "1.0.0",
    description: "微博发布、热搜获取、转发功能",
    author: "jarvis",
    category: "publish",
    tags: ["weibo", "微博", "sina", "publish", "social"],
    triggers: ["微博", "weibo", "新浪"],
    tools: ["weibo-publish", "weibo-hot-search", "weibo-repost"],
    permissions: ["network"],
    requires: {
      config: ["trendApiUrl"],
    },
    enabled: true,
  },
  createWeiboTools
);

export default weiboPublisherSkill;
