/**
 * Skill: xhs-publisher — 小红书发布与搜索
 *
 * 工具：
 * - xhs-publish: 发布小红书笔记
 * - xhs-search: 搜索小红书内容
 * - xhs-check-login: 检查登录状态
 *
 * 依赖开源项目：xiaohongshu-mcp
 */

import { wrapToolsAsSkill } from "../define.js";
import { createXhsTools } from "../../tools/xhs.js";

export const xhsPublisherSkill = wrapToolsAsSkill(
  {
    name: "xhs-publisher",
    version: "1.0.0",
    description: "小红书笔记发布、内容搜索、登录状态管理",
    author: "jarvis",
    category: "publish",
    tags: ["xiaohongshu", "xhs", "小红书", "publish", "social"],
    triggers: ["小红书", "xhs", "红书"],
    tools: ["xhs-publish", "xhs-search", "xhs-check-login"],
    permissions: ["network"],
    requires: {
      config: ["xhsApiUrl"],
    },
    enabled: true,
  },
  createXhsTools
);

export default xhsPublisherSkill;
