/**
 * Skill: browser-pilot — Playwright 浏览器自动化
 *
 * 工具：
 * - browser-navigate: 页面导航
 * - browser-screenshot: 截图
 * - browser-extract: DOM 内容提取
 * - browser-fill-form: 表单自动填写
 * - browser-click: 点击操作
 * - browser-cookies: Cookie 管理
 * - browser-wait: 等待元素/页面
 * - browser-evaluate: 执行 JS
 * - browser-close: 关闭浏览器
 * - browser-pdf: PDF 导出
 *
 * 灵感来源: OpenClaw Browser Control
 */

import { wrapToolsAsSkill } from "../define.js";
import { createBrowserTools } from "../../tools/browser.js";

export const browserPilotSkill = wrapToolsAsSkill(
  {
    name: "browser-pilot",
    version: "1.0.0",
    description: "Playwright 浏览器自动化 — 导航/截图/提取/填表/Cookie/PDF",
    author: "jarvis",
    category: "workflow",
    tags: ["browser", "playwright", "automation", "scraping", "浏览器"],
    triggers: ["浏览器", "browser", "截图", "网页", "登录"],
    tools: [
      "browser-navigate",
      "browser-screenshot",
      "browser-extract",
      "browser-fill-form",
      "browser-click",
      "browser-cookies",
      "browser-wait",
      "browser-evaluate",
      "browser-close",
      "browser-pdf",
    ],
    permissions: ["network", "filesystem"],
    requires: {},
    enabled: true,
  },
  createBrowserTools
);

export default browserPilotSkill;
