/**
 * 内置 Skill 注册表
 *
 * 导出所有内置 Skill 工厂函数（10 个 Skill）
 */

import type { SkillFactory } from "../types.js";

export { contentScraperSkill } from "./content-scraper.js";
export { contentWriterSkill } from "./content-writer.js";
export { xhsPublisherSkill } from "./xhs-publisher.js";
export { wechatPublisherSkill } from "./wechat-publisher.js";
export { multiDistributorSkill } from "./multi-distributor.js";
export { douyinPublisherSkill } from "./douyin-publisher.js";
export { bilibiliPublisherSkill } from "./bilibili-publisher.js";
export { weiboPublisherSkill } from "./weibo-publisher.js";
export { zhihuPublisherSkill } from "./zhihu-publisher.js";
export { browserPilotSkill } from "./browser-pilot.js";

// ==================== 全部内置 Skill ====================

import { contentScraperSkill } from "./content-scraper.js";
import { contentWriterSkill } from "./content-writer.js";
import { xhsPublisherSkill } from "./xhs-publisher.js";
import { wechatPublisherSkill } from "./wechat-publisher.js";
import { multiDistributorSkill } from "./multi-distributor.js";
import { douyinPublisherSkill } from "./douyin-publisher.js";
import { bilibiliPublisherSkill } from "./bilibili-publisher.js";
import { weiboPublisherSkill } from "./weibo-publisher.js";
import { zhihuPublisherSkill } from "./zhihu-publisher.js";
import { browserPilotSkill } from "./browser-pilot.js";

/** 获取所有内置 Skill 工厂 */
export function getAllBundledSkills(): SkillFactory[] {
  return [
    contentScraperSkill,
    contentWriterSkill,
    xhsPublisherSkill,
    wechatPublisherSkill,
    multiDistributorSkill,
    douyinPublisherSkill,
    bilibiliPublisherSkill,
    weiboPublisherSkill,
    zhihuPublisherSkill,
    browserPilotSkill,
  ];
}
