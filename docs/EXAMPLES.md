# Jarvis Agent 示例代码

## 1. 一键启动 + 对话

```typescript
import { createJarvis } from "jarvis-agent-core";

const jarvis = await createJarvis({
  agent: { llm: { provider: "siliconflow", apiKey: "sk-xxx" } },
  web: { port: 3800 },
});

// 对话（自动 RAG + 知识库 + 风控）
const reply = await jarvis.chat("帮我写一篇关于 AI 的小红书笔记");
console.log(reply);

// 启动 Web UI
await jarvis.startWeb();

// 优雅关闭
process.on("SIGINT", () => jarvis.shutdown());
```

## 2. 知识库增强

```typescript
const jarvis = await createJarvis();

jarvis.knowledge.addDocument(
  "运营指南",
  "小红书标题不超过 20 字。配图选明亮色调。晚上 8 点发布效果好。",
  { tags: ["xhs", "运营"] }
);

const reply = await jarvis.chat("小红书怎么运营？");
// LLM 会参考知识库内容回答
```

## 3. 向量记忆

```typescript
jarvis.memory.remember("用户喜欢简洁风格", "preference", { importance: 9 });
jarvis.memory.remember("上次发布了 AI 副业文章，效果很好", "publish");

const results = jarvis.memory.search("用户偏好", 3);
```

## 4. 事件与通知

```typescript
jarvis.events.on("publish:success", (data) => {
  console.log("发布成功:", data.platform, data.title);
});

jarvis.events.emit("publish:success", {
  platform: "小红书",
  title: "AI 副业攻略",
  url: "https://...",
});

const unread = jarvis.notifications.getUnreadCount();
```

## 5. 单独使用各模块

```typescript
import {
  AgentCore,
  createAgent,
  VectorMemory,
  KnowledgeBase,
  ConfigLoader,
} from "jarvis-agent-core";

const config = new ConfigLoader().load();
const agent = createAgent({ llm: config.llm });
await agent.initialize();

const memory = new VectorMemory({ dataPath: "./data/vector.json" });
memory.remember("关键信息", "fact");

const task = await agent.run("采集今日热点");
```
