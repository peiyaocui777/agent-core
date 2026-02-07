# Skill 扩展指南

## 热门参考项目（2024–2025）

| 项目 | Stars | 用途 |
|------|-------|------|
| [agentskills/agentskills](https://github.com/agentskills/agentskills) | 8.7k | Agent Skills 官方规范 |
| [skillcreatorai/Ai-Agent-Skills](https://github.com/skillcreatorai/Ai-Agent-Skills) | 744 | 跨 AI 代理的 Skill 包管理器，50+ 预制技能 |
| [heilcheng/awesome-agent-skills](https://github.com/heilcheng/awesome-agent-skills) | 1.8k | AI 编程代理技能工具集合 |
| [openai/skills](https://github.com/openai/skills) | 4k | OpenAI Codex 技能目录 |
| [skillmatic-ai/awesome-agent-skills](https://github.com/skillmatic-ai/awesome-agent-skills) | 134 | 学习资源 + Claude Skills 教程 |

## Jarvis 内置 Skill 一览

| Skill | 工具数 | 分类 | 说明 |
|-------|--------|------|------|
| content-scraper | 4 | content | 热点采集、小红书搜索、URL 提取、AI 排名 |
| content-writer | 3 | content | AI 生成、配图、摘要 |
| xhs-publisher | 3 | publish | 小红书发布、搜索、登录检查 |
| wechat-publisher | 2 | publish | 公众号发布、Markdown 排版 |
| multi-distributor | 4 | publish | 多平台分发、状态检查、图床上传 |
| douyin-publisher | 3 | publish | 抖音短视频/图文、热搜 |
| bilibili-publisher | 3 | publish | B 站专栏/动态、热门 |
| weibo-publisher | 3 | publish | 微博发布、热搜、转发 |
| zhihu-publisher | 4 | publish | 知乎文章、回答、热榜、搜索 |
| browser-pilot | 10 | workflow | 导航、截图、提取、填表、Cookie、PDF |

## 创建自定义 Skill

```bash
# 使用 PluginSDK 脚手架
npx jarvis-agent scaffold my-weather-skill
```

或参考 `src/skills/bundled/` 下任意 Skill 的 `skill.json` + `index.ts` 结构。
