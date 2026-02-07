/**
 * Skill: douyin-publisher — 抖音短视频/图文发布
 *
 * 工具：
 * - douyin-publish-video: 发布短视频
 * - douyin-publish-image: 发布图文笔记
 * - douyin-trending: 获取抖音热搜
 */

import { wrapToolsAsSkill } from "../define.js";
import { createDouyinTools } from "../../tools/douyin.js";

export const douyinPublisherSkill = wrapToolsAsSkill(
  {
    name: "douyin-publisher",
    version: "1.0.0",
    description: "抖音短视频发布、图文笔记发布、热搜获取",
    author: "jarvis",
    category: "publish",
    tags: ["douyin", "抖音", "tiktok", "短视频", "publish", "social"],
    triggers: ["抖音", "douyin", "短视频"],
    tools: ["douyin-publish-video", "douyin-publish-image", "douyin-trending"],
    permissions: ["network"],
    requires: {
      config: ["trendApiUrl"],
    },
    enabled: true,
  },
  createDouyinTools
);

export default douyinPublisherSkill;
