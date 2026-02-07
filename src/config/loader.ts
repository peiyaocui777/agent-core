/**
 * ConfigLoader — 统一配置中心
 *
 * 配置加载优先级（从高到低）：
 * 1. 环境变量 (JARVIS_*)
 * 2. .env 文件
 * 3. jarvis.config.yaml / jarvis.config.json
 * 4. 内置默认值
 *
 * 支持:
 * - YAML / JSON 配置文件
 * - 环境变量自动映射
 * - 配置校验
 * - jarvis init 向导式初始化
 */

import * as fs from "fs";
import * as path from "path";

// ==================== 类型 ====================

export interface JarvisConfig {
  /** LLM 配置 */
  llm: {
    provider: "deepseek" | "openai" | "gemini" | "claude" | "ollama";
    apiKey?: string;
    model?: string;
    baseUrl?: string;
    temperature?: number;
  };

  /** Agent 基本配置 */
  agent: {
    name: string;
    persona: "assistant" | "content_expert" | "tech_geek";
    language: string;
    memoryPath: string;
  };

  /** 平台配置 */
  platforms: {
    xiaohongshu?: { apiUrl: string; enabled: boolean };
    wechat?: { apiUrl: string; enabled: boolean };
    douyin?: { apiUrl: string; enabled: boolean };
    bilibili?: { apiUrl: string; enabled: boolean };
    weibo?: { apiUrl: string; enabled: boolean };
    zhihu?: { apiUrl: string; enabled: boolean };
  };

  /** Telegram Bot */
  telegram?: {
    botToken: string;
    allowedUsers?: number[];
  };

  /** 安全配置 */
  safety: {
    level: "strict" | "moderate" | "loose";
    dailyPublishLimit: number;
    activeHours: [number, number];
  };

  /** 服务配置 */
  server: {
    dashboardPort: number;
    mcpPort?: number;
  };

  /** 调度配置 */
  scheduler: {
    enabled: boolean;
    checkInterval: number;
  };

  /** 高级配置 */
  advanced: {
    browserHeadless: boolean;
    vectorMemoryEnabled: boolean;
    maxConcurrency: number;
    logLevel: "debug" | "info" | "warn" | "error";
  };
}

// ==================== 默认配置 ====================

const DEFAULT_CONFIG: JarvisConfig = {
  llm: {
    provider: "deepseek",
    model: "deepseek-chat",
    temperature: 0.7,
  },
  agent: {
    name: "Jarvis",
    persona: "assistant",
    language: "zh-CN",
    memoryPath: "~/.jarvis/memory",
  },
  platforms: {},
  safety: {
    level: "moderate",
    dailyPublishLimit: 30,
    activeHours: [8, 23],
  },
  server: {
    dashboardPort: 3800,
  },
  scheduler: {
    enabled: true,
    checkInterval: 60000,
  },
  advanced: {
    browserHeadless: true,
    vectorMemoryEnabled: true,
    maxConcurrency: 3,
    logLevel: "info",
  },
};

// ==================== 环境变量映射 ====================

const ENV_MAP: Record<string, string> = {
  JARVIS_LLM_PROVIDER: "llm.provider",
  JARVIS_LLM_API_KEY: "llm.apiKey",
  JARVIS_LLM_MODEL: "llm.model",
  JARVIS_LLM_BASE_URL: "llm.baseUrl",
  JARVIS_AGENT_NAME: "agent.name",
  JARVIS_AGENT_PERSONA: "agent.persona",
  JARVIS_MEMORY_PATH: "agent.memoryPath",
  JARVIS_TELEGRAM_TOKEN: "telegram.botToken",
  JARVIS_SAFETY_LEVEL: "safety.level",
  JARVIS_DASHBOARD_PORT: "server.dashboardPort",
  JARVIS_LOG_LEVEL: "advanced.logLevel",
  JARVIS_XHS_API_URL: "platforms.xiaohongshu.apiUrl",
  JARVIS_WECHAT_API_URL: "platforms.wechat.apiUrl",
  DEEPSEEK_API_KEY: "llm.apiKey",
  OPENAI_API_KEY: "llm.apiKey",
};

// ==================== ConfigLoader ====================

export class ConfigLoader {
  private config: JarvisConfig;
  private configPath: string | null = null;

  constructor() {
    this.config = this.deepClone(DEFAULT_CONFIG);
  }

  /**
   * 加载配置（按优先级合并）
   */
  load(cwd?: string): JarvisConfig {
    const workDir = cwd || process.cwd();

    // 1. 默认值（已设置）

    // 2. 配置文件
    this.loadConfigFile(workDir);

    // 3. .env 文件
    this.loadEnvFile(workDir);

    // 4. 环境变量（最高优先级）
    this.loadEnvVars();

    return this.config;
  }

  /** 获取当前配置 */
  getConfig(): JarvisConfig {
    return this.config;
  }

  /** 获取配置文件路径 */
  getConfigPath(): string | null {
    return this.configPath;
  }

  // ==================== 配置文件 ====================

  private loadConfigFile(cwd: string): void {
    const candidates = [
      path.join(cwd, "jarvis.config.yaml"),
      path.join(cwd, "jarvis.config.yml"),
      path.join(cwd, "jarvis.config.json"),
      path.join(cwd, ".jarvis.json"),
    ];

    for (const filePath of candidates) {
      if (fs.existsSync(filePath)) {
        try {
          const raw = fs.readFileSync(filePath, "utf-8");
          let parsed: Record<string, unknown>;

          if (filePath.endsWith(".yaml") || filePath.endsWith(".yml")) {
            parsed = this.parseSimpleYaml(raw);
          } else {
            parsed = JSON.parse(raw);
          }

          this.deepMerge(this.config as unknown as Record<string, unknown>, parsed);
          this.configPath = filePath;
          return;
        } catch {
          // 继续尝试下一个
        }
      }
    }
  }

  // ==================== .env 文件 ====================

  private loadEnvFile(cwd: string): void {
    const envPath = path.join(cwd, ".env");
    if (!fs.existsSync(envPath)) return;

    try {
      const raw = fs.readFileSync(envPath, "utf-8");
      const lines = raw.split("\n");

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        const eqIdx = trimmed.indexOf("=");
        if (eqIdx < 0) continue;

        const key = trimmed.slice(0, eqIdx).trim();
        let value = trimmed.slice(eqIdx + 1).trim();

        // 去除引号
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }

        // 只处理映射表中的 key
        if (ENV_MAP[key]) {
          this.setNestedValue(this.config as unknown as Record<string, unknown>, ENV_MAP[key], this.parseValue(value));
        }
      }
    } catch {
      // ignore
    }
  }

  // ==================== 环境变量 ====================

  private loadEnvVars(): void {
    for (const [envKey, configPath] of Object.entries(ENV_MAP)) {
      const value = process.env[envKey];
      if (value !== undefined) {
        this.setNestedValue(this.config as unknown as Record<string, unknown>, configPath, this.parseValue(value));
      }
    }
  }

  // ==================== 配置校验 ====================

  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!this.config.llm.provider) {
      errors.push("缺少 llm.provider（设置 JARVIS_LLM_PROVIDER）");
    }

    if (!this.config.llm.apiKey && this.config.llm.provider !== "ollama") {
      errors.push("缺少 llm.apiKey（设置 JARVIS_LLM_API_KEY 或 DEEPSEEK_API_KEY）");
    }

    if (this.config.server.dashboardPort < 1 || this.config.server.dashboardPort > 65535) {
      errors.push("dashboardPort 应在 1-65535 之间");
    }

    return { valid: errors.length === 0, errors };
  }

  // ==================== 生成配置文件模板 ====================

  /** 生成 YAML 配置模板 */
  static generateYamlTemplate(): string {
    return `# Jarvis Agent 配置文件
# 详情参考: https://github.com/yourname/jarvis-agent#configuration

# LLM 配置
llm:
  provider: deepseek          # deepseek / openai / gemini / claude / ollama
  apiKey: ""                  # 或使用环境变量 JARVIS_LLM_API_KEY
  model: deepseek-chat
  temperature: 0.7

# Agent 基本配置
agent:
  name: Jarvis
  persona: assistant          # assistant / content_expert / tech_geek
  language: zh-CN
  memoryPath: ~/.jarvis/memory

# 平台配置（按需启用）
platforms:
  xiaohongshu:
    apiUrl: http://localhost:18060
    enabled: true
  wechat:
    apiUrl: http://localhost:18061
    enabled: false
  douyin:
    apiUrl: http://localhost:18070
    enabled: false

# Telegram Bot（可选）
# telegram:
#   botToken: "your-bot-token"
#   allowedUsers: [123456789]

# 安全配置
safety:
  level: moderate             # strict / moderate / loose
  dailyPublishLimit: 30
  activeHours: [8, 23]

# 服务配置
server:
  dashboardPort: 3800

# 调度配置
scheduler:
  enabled: true
  checkInterval: 60000

# 高级配置
advanced:
  browserHeadless: true
  vectorMemoryEnabled: true
  maxConcurrency: 3
  logLevel: info              # debug / info / warn / error
`;
  }

  /** 生成 .env 模板 */
  static generateEnvTemplate(): string {
    return `# Jarvis Agent 环境变量
# 复制此文件为 .env 并填入你的 API Key

# LLM 配置（必填）
JARVIS_LLM_PROVIDER=deepseek
JARVIS_LLM_API_KEY=sk-your-api-key-here
# JARVIS_LLM_MODEL=deepseek-chat
# JARVIS_LLM_BASE_URL=

# 或直接使用各平台的 Key
# DEEPSEEK_API_KEY=sk-xxx
# OPENAI_API_KEY=sk-xxx

# Agent 配置
# JARVIS_AGENT_NAME=Jarvis
# JARVIS_AGENT_PERSONA=assistant

# Telegram Bot（可选）
# JARVIS_TELEGRAM_TOKEN=your-bot-token

# 平台 API（可选）
# JARVIS_XHS_API_URL=http://localhost:18060
# JARVIS_WECHAT_API_URL=http://localhost:18061

# 安全
# JARVIS_SAFETY_LEVEL=moderate

# 服务
# JARVIS_DASHBOARD_PORT=3800

# 日志
# JARVIS_LOG_LEVEL=info
`;
  }

  /** 生成 Docker Compose 模板 */
  static generateDockerCompose(): string {
    return `version: "3.8"

services:
  jarvis:
    build: .
    container_name: jarvis-agent
    ports:
      - "\${JARVIS_DASHBOARD_PORT:-3800}:3800"
    volumes:
      - ./jarvis.config.yaml:/app/jarvis.config.yaml
      - jarvis-data:/app/data
    env_file:
      - .env
    restart: unless-stopped

volumes:
  jarvis-data:
`;
  }

  /** 生成 Dockerfile 模板 */
  static generateDockerfile(): string {
    return `FROM node:20-slim

WORKDIR /app

# 安装 Playwright 浏览器依赖（可选）
# RUN npx playwright install-deps chromium

COPY package*.json ./
RUN npm ci --production

COPY dist/ ./dist/
COPY jarvis.config.yaml ./

ENV NODE_ENV=production
EXPOSE 3800

CMD ["node", "dist/main.js"]
`;
  }

  // ==================== 内部辅助 ====================

  private parseSimpleYaml(raw: string): Record<string, unknown> {
    // 简易 YAML 解析（支持基本结构）
    const result: Record<string, unknown> = {};
    const lines = raw.split("\n");
    const stack: Array<{ obj: Record<string, unknown>; indent: number }> = [{ obj: result, indent: -1 }];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const indent = line.search(/\S/);
      const colonIdx = trimmed.indexOf(":");

      if (colonIdx < 0) continue;

      const key = trimmed.slice(0, colonIdx).trim();
      const valueStr = trimmed.slice(colonIdx + 1).trim();

      // 回退到正确的层级
      while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
        stack.pop();
      }

      const parent = stack[stack.length - 1].obj;

      if (!valueStr || valueStr.startsWith("#")) {
        // 嵌套对象
        const child: Record<string, unknown> = {};
        parent[key] = child;
        stack.push({ obj: child, indent });
      } else {
        parent[key] = this.parseValue(valueStr.replace(/#.*$/, "").trim());
      }
    }

    return result;
  }

  private parseValue(value: string): unknown {
    if (value === "true") return true;
    if (value === "false") return false;
    if (value === "null") return null;
    if (/^\d+$/.test(value)) return parseInt(value);
    if (/^\d+\.\d+$/.test(value)) return parseFloat(value);
    if (value.startsWith("[") && value.endsWith("]")) {
      try { return JSON.parse(value); } catch { return value; }
    }
    // 去除引号
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1);
    }
    return value;
  }

  private setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
    const keys = path.split(".");
    let current: Record<string, unknown> = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]] || typeof current[keys[i]] !== "object") {
        current[keys[i]] = {};
      }
      current = current[keys[i]] as Record<string, unknown>;
    }
    current[keys[keys.length - 1]] = value;
  }

  private deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(source)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        if (!target[key] || typeof target[key] !== "object") {
          target[key] = {};
        }
        this.deepMerge(target[key] as Record<string, unknown>, value as Record<string, unknown>);
      } else {
        target[key] = value;
      }
    }
  }

  private deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
  }
}
