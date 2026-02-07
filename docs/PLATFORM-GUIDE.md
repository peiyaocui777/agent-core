# 平台对接指南

Jarvis Agent 通过**本地代理服务**对接各社交媒体平台。每个平台有独立的代理进程，Agent 通过 HTTP API 调用。

---

## 架构概览

```
Jarvis Agent (Node.js)
    │
    ├── 小红书 Skill ──→ xiaohongshu-mcp (Go + Rod)        :18060
    ├── 公众号 Skill ──→ wenyan-mcp (Node.js)              :18061
    ├── 抖音 Skill   ──→ social-auto-upload (Python + PW)  :18070
    ├── B站 Skill    ──→ social-auto-upload                :18080
    ├── 微博 Skill   ──→ social-auto-upload                :18090
    └── 知乎 Skill   ──→ social-auto-upload                :18100
```

---

## 1. 小红书

### 依赖项目
- **xiaohongshu-mcp**: Go + Rod 浏览器自动化
- GitHub: `xiaohongshu-mcp`
- 许可证: MIT

### 启动

```bash
# 方式 1: 直接运行
cd opensource/登录认证/xiaohongshu-mcp
go run .

# 方式 2: Docker
docker run -p 18060:18060 xiaohongshu-mcp
```

### API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/publish` | 发布图文笔记 |
| GET | `/api/v1/search?keyword=xxx` | 搜索笔记 |
| GET | `/api/v1/login/status` | 检查登录状态 |
| GET | `/api/v1/login/qr` | 获取二维码登录 |

### Jarvis 配置

```yaml
# jarvis.config.yaml
platforms:
  xiaohongshu:
    apiUrl: http://localhost:18060
    enabled: true
```

---

## 2. 微信公众号

### 依赖项目
- **wenyan-mcp**: Markdown → 公众号排版发布
- 许可证: Apache-2.0

### 启动

```bash
cd opensource/平台发布/wenyan-mcp
npm install && npm start
# 默认端口: 18061
```

### API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/publish` | 发布文章 |
| POST | `/api/format` | Markdown 排版 |

### Jarvis 配置

```yaml
platforms:
  wechat:
    apiUrl: http://localhost:18061
    enabled: true
```

---

## 3. 抖音 / B站 / 微博 / 知乎

### 依赖项目
- **social-auto-upload**: Python + Playwright 多平台上传
- 支持: 抖音/B站/微博/知乎/快手/视频号
- 许可证: MIT

### 安装

```bash
cd opensource/平台发布/social-auto-upload
pip install -r requirements.txt
playwright install chromium
```

### 启动各平台代理

```bash
# 每个平台启动独立实例（不同端口）
python server.py --platform douyin  --port 18070
python server.py --platform bilibili --port 18080
python server.py --platform weibo   --port 18090
python server.py --platform zhihu   --port 18100
```

### Jarvis 配置

```yaml
platforms:
  douyin:
    apiUrl: http://localhost:18070
    enabled: true
  bilibili:
    apiUrl: http://localhost:18080
    enabled: true
  weibo:
    apiUrl: http://localhost:18090
    enabled: false
  zhihu:
    apiUrl: http://localhost:18100
    enabled: false
```

---

## 4. Docker Compose 一键启动所有代理

```yaml
# docker-compose.platforms.yml
version: "3.8"

services:
  xhs-proxy:
    build: ./opensource/登录认证/xiaohongshu-mcp
    ports: ["18060:18060"]
    volumes:
      - xhs-data:/app/data

  wechat-proxy:
    build: ./opensource/平台发布/wenyan-mcp
    ports: ["18061:18061"]

  social-upload:
    build: ./opensource/平台发布/social-auto-upload
    ports:
      - "18070:18070"
      - "18080:18080"
      - "18090:18090"
      - "18100:18100"
    environment:
      - PLAYWRIGHT_BROWSERS_PATH=/app/browsers

volumes:
  xhs-data:
```

---

## 5. 登录认证流程

大多数平台需要先扫码登录：

1. 启动对应平台代理服务
2. 通过 Jarvis CLI 或 Web UI 触发登录
3. 扫码完成认证
4. Cookie 自动保存到本地

```bash
# CLI 方式
jarvis-agent run "检查小红书登录状态"
# 如果未登录，会返回二维码 URL

# 或直接访问代理服务
curl http://localhost:18060/api/v1/login/qr
```

---

## 6. 快速验证

```bash
# 检查所有平台状态
jarvis-agent run "检查所有平台状态"

# 发布测试（小红书）
jarvis-agent run "发布一条测试笔记到小红书，标题：AI助手测试"

# 多平台分发
jarvis-agent run "把这篇文章发到小红书和公众号"
```
