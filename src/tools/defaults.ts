/**
 * 默认工具集工厂 —— 一键注册所有内置工具
 */

import type { Tool, AgentConfig } from "../types.js";
import { createXhsTools } from "./xhs.js";
import { createWechatTools } from "./wechat.js";
import { createAiTools } from "./ai.js";
import { createWorkflowTools } from "./workflow.js";
import { createScraperTools } from "./scraper.js";
import { createMultiPublishTools } from "./multi-publish.js";

/** 创建所有默认工具 */
export function createAllDefaultTools(config: AgentConfig = {}): Tool[] {
  return [
    ...createXhsTools(config),
    ...createWechatTools(config),
    ...createAiTools(config),
    ...createWorkflowTools(config),
    ...createScraperTools(config),
    ...createMultiPublishTools(config),
  ];
}
