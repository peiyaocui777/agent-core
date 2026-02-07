/**
 * Skill: multi-distributor — 多平台统一分发
 *
 * 工具：
 * - multi-publish: 一键多平台发布（小红书/公众号/抖音/B站/快手/视频号）
 * - check-platform-status: 检查各平台服务状态
 * - upload-image: 上传图片到图床
 * - trigger-workflow: 触发自动化工作流
 *
 * 依赖开源项目：social-auto-upload, CloudFlare-ImgBed
 */

import { wrapToolsAsSkill } from "../define.js";
import { createMultiPublishTools } from "../../tools/multi-publish.js";
import { createWorkflowTools } from "../../tools/workflow.js";
import type { AgentConfig, Tool } from "../../types.js";

function createDistributorTools(config: AgentConfig): Tool[] {
  return [
    ...createMultiPublishTools(config),
    ...createWorkflowTools(config),
  ];
}

export const multiDistributorSkill = wrapToolsAsSkill(
  {
    name: "multi-distributor",
    version: "1.0.0",
    description: "多平台统一内容分发 — 一键发布到小红书/公众号/抖音/B站/快手/视频号 + 图床上传 + 工作流触发",
    author: "jarvis",
    category: "publish",
    tags: ["multi-platform", "distribute", "publish", "upload"],
    triggers: ["多平台", "全平台", "分发", "一键发", "所有平台"],
    tools: ["multi-publish", "check-platform-status", "upload-image", "trigger-workflow"],
    permissions: ["network", "filesystem"],
    enabled: true,
  },
  createDistributorTools
);

export default multiDistributorSkill;
