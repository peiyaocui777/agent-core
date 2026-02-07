/**
 * Skill: wechat-publisher — 微信公众号发布
 *
 * 工具：
 * - wechat-publish: 发布公众号文章
 * - wechat-format: Markdown → 公众号格式化
 *
 * 依赖开源项目：wenyan-mcp, ai-trend-publish
 */

import { wrapToolsAsSkill } from "../define.js";
import { createWechatTools } from "../../tools/wechat.js";

export const wechatPublisherSkill = wrapToolsAsSkill(
  {
    name: "wechat-publisher",
    version: "1.0.0",
    description: "微信公众号文章发布与 Markdown 排版",
    author: "jarvis",
    category: "publish",
    tags: ["wechat", "公众号", "weixin", "publish"],
    triggers: ["公众号", "微信", "wechat"],
    tools: ["wechat-publish", "wechat-format"],
    permissions: ["network"],
    enabled: true,
  },
  createWechatTools
);

export default wechatPublisherSkill;
