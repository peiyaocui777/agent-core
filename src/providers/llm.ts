/**
 * LLM Provider 统一抽象层
 *
 * 支持 OpenAI 兼容 API（DeepSeek / Gemini / OpenAI / 自定义）。
 * 所有 provider 都使用 OpenAI 兼容格式，通过 baseUrl 切换。
 */

import type { AgentConfig } from "../types.js";

// ==================== 类型 ====================

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMResponse {
  content: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface LLMOptions {
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json_object";
}

// ==================== Provider 配置 ====================

const PROVIDER_DEFAULTS: Record<string, { baseUrl: string; model: string }> = {
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
  },
  openai: {
    baseUrl: "https://api.openai.com",
    model: "gpt-4o-mini",
  },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.0-flash",
  },
  custom: {
    baseUrl: "http://localhost:11434/v1",
    model: "llama3",
  },
};

// ==================== LLM Client ====================

export class LLMClient {
  private baseUrl: string;
  private model: string;
  private apiKey: string;
  private provider: string;

  constructor(config: AgentConfig) {
    const llmConfig = config.llm;
    if (!llmConfig?.apiKey) {
      throw new Error("LLM API Key 未配置。请在 AgentConfig.llm 中设置 apiKey。");
    }

    this.provider = llmConfig.provider || "deepseek";
    const defaults = PROVIDER_DEFAULTS[this.provider] || PROVIDER_DEFAULTS.custom;

    this.baseUrl = llmConfig.baseUrl || defaults.baseUrl;
    this.model = llmConfig.model || defaults.model;
    this.apiKey = llmConfig.apiKey;
  }

  /** 调用 LLM Chat Completions API（OpenAI 兼容格式） */
  async chat(messages: LLMMessage[], options: LLMOptions = {}): Promise<LLMResponse> {
    const url = `${this.baseUrl}/chat/completions`;

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 2048,
    };

    if (options.responseFormat === "json_object") {
      body.response_format = { type: "json_object" };
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM API 调用失败 [${response.status}]: ${errorText}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
      model: string;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };

    return {
      content: data.choices[0]?.message?.content || "",
      model: data.model,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined,
    };
  }

  /** 简易调用：单条 prompt → 文本回复 */
  async complete(prompt: string, options: LLMOptions = {}): Promise<string> {
    const response = await this.chat(
      [{ role: "user", content: prompt }],
      options
    );
    return response.content;
  }

  /** JSON 模式调用：prompt → 解析后的 JSON 对象 */
  async completeJSON<T = Record<string, unknown>>(
    prompt: string,
    options: LLMOptions = {}
  ): Promise<T> {
    const response = await this.chat(
      [
        {
          role: "system",
          content: "你是一个内容生成助手。请严格按照 JSON 格式输出，不要包含多余文本。",
        },
        { role: "user", content: prompt },
      ],
      { ...options, responseFormat: "json_object" }
    );

    try {
      return JSON.parse(response.content) as T;
    } catch {
      // 如果 JSON 解析失败，尝试提取 JSON 块
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as T;
      }
      throw new Error(`LLM 返回了非 JSON 内容: ${response.content.slice(0, 200)}`);
    }
  }

  /**
   * 流式调用 LLM（SSE 方式）
   * 每收到一个 token 回调 onChunk，完成后回调 onDone
   */
  async chatStream(
    messages: LLMMessage[],
    callbacks: {
      onChunk: (text: string) => void;
      onDone?: (fullText: string) => void;
      onError?: (error: Error) => void;
    },
    options: LLMOptions = {}
  ): Promise<string> {
    const url = `${this.baseUrl}/chat/completions`;

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 2048,
      stream: true,
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LLM Stream API 失败 [${response.status}]: ${errorText}`);
      }

      if (!response.body) {
        throw new Error("Response body is null — streaming not supported");
      }

      let fullText = "";
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;

          const data = trimmed.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data) as {
              choices: Array<{ delta: { content?: string }; finish_reason?: string }>;
            };
            const content = parsed.choices[0]?.delta?.content;
            if (content) {
              fullText += content;
              callbacks.onChunk(content);
            }
          } catch {
            // 忽略非法 JSON 行
          }
        }
      }

      callbacks.onDone?.(fullText);
      return fullText;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      callbacks.onError?.(err);
      throw err;
    }
  }

  /** 流式简易调用：prompt → onChunk 逐字回调 */
  async completeStream(
    prompt: string,
    onChunk: (text: string) => void,
    options: LLMOptions = {}
  ): Promise<string> {
    return this.chatStream(
      [{ role: "user", content: prompt }],
      { onChunk },
      options
    );
  }

  /** 获取当前 provider 信息 */
  getInfo(): { provider: string; model: string; baseUrl: string } {
    return {
      provider: this.provider,
      model: this.model,
      baseUrl: this.baseUrl,
    };
  }
}

/** 创建 LLM 客户端（如果配置了 API Key） */
export function createLLMClient(config: AgentConfig): LLMClient | null {
  if (!config.llm?.apiKey) {
    console.warn("[LLM] 未配置 API Key，AI 功能将使用 fallback 模式");
    return null;
  }
  return new LLMClient(config);
}
