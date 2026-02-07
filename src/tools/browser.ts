/**
 * 浏览器自动化工具集 — BrowserPilot
 *
 * 基于 Playwright 的浏览器控制能力：
 * - 页面导航与截图
 * - DOM 元素提取
 * - 表单自动填写
 * - Cookie/登录态管理
 * - PDF 导出
 *
 * 参考: OpenClaw Browser Control
 */

import type { Tool, AgentConfig } from "../types.js";

/** 浏览器实例管理器（单例） */
interface BrowserInstance {
  browser: unknown;
  context: unknown;
  page: unknown;
}

let _instance: BrowserInstance | null = null;

/**
 * 动态加载 Playwright（避免硬依赖）
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getPlaywright(): Promise<any> {
  try {
    // 动态加载 playwright（可选依赖，不强制安装）
    // @ts-expect-error playwright is an optional dependency
    return await import("playwright");
  } catch {
    return null;
  }
}

/**
 * 获取或创建浏览器实例
 */
async function ensureBrowser(config: AgentConfig): Promise<BrowserInstance | null> {
  if (_instance) return _instance;

  const pw = await getPlaywright();
  if (!pw) return null;

  const browser = await pw.chromium.launch({
    headless: config.browserHeadless !== false,
  });

  const context = await (browser as any).newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 720 },
  });

  const page = await (context as any).newPage();
  _instance = { browser, context, page };
  return _instance;
}

export function createBrowserTools(config: AgentConfig = {}): Tool[] {
  return [
    // ==================== 1. 页面导航 ====================
    {
      name: "browser-navigate",
      description: "导航到指定 URL 并等待页面加载完成",
      category: "workflow",
      parameters: {
        url: { type: "string", description: "目标 URL", required: true },
        waitUntil: {
          type: "string",
          description: "等待策略: load/domcontentloaded/networkidle",
          required: false,
        },
        timeout: { type: "number", description: "超时时间(ms)", required: false },
      },
      execute: async (params) => {
        try {
          const inst = await ensureBrowser(config);
          if (!inst) return { success: false, error: "Playwright 未安装，请运行: npm install playwright" };

          const page = inst.page as any;
          await page.goto(params.url as string, {
            waitUntil: params.waitUntil || "domcontentloaded",
            timeout: (params.timeout as number) || 30000,
          });

          const title = await page.title();
          const url = page.url();

          return {
            success: true,
            data: { title, url, status: "loaded" },
          };
        } catch (error) {
          return { success: false, error: `导航失败: ${error instanceof Error ? error.message : String(error)}` };
        }
      },
    },

    // ==================== 2. 页面截图 ====================
    {
      name: "browser-screenshot",
      description: "对当前页面截图并保存到指定路径",
      category: "workflow",
      parameters: {
        path: { type: "string", description: "保存路径（如 /tmp/shot.png）", required: true },
        fullPage: { type: "boolean", description: "是否全页截图", required: false },
        selector: { type: "string", description: "仅截取指定选择器区域", required: false },
      },
      execute: async (params) => {
        try {
          const inst = await ensureBrowser(config);
          if (!inst) return { success: false, error: "Playwright 未安装" };

          const page = inst.page as any;

          if (params.selector) {
            const element = await page.$(params.selector as string);
            if (!element) return { success: false, error: `选择器未找到: ${params.selector}` };
            await element.screenshot({ path: params.path as string });
          } else {
            await page.screenshot({
              path: params.path as string,
              fullPage: params.fullPage !== false,
            });
          }

          return {
            success: true,
            data: { path: params.path, message: "截图已保存" },
          };
        } catch (error) {
          return { success: false, error: `截图失败: ${error instanceof Error ? error.message : String(error)}` };
        }
      },
    },

    // ==================== 3. DOM 内容提取 ====================
    {
      name: "browser-extract",
      description: "从当前页面提取指定内容（标题/文字/链接/图片/自定义选择器）",
      category: "workflow",
      parameters: {
        type: {
          type: "string",
          description: "提取类型: text/links/images/meta/selector",
          required: true,
        },
        selector: { type: "string", description: "CSS 选择器（type=selector 时必填）", required: false },
        attribute: { type: "string", description: "提取的属性名", required: false },
        limit: { type: "number", description: "最大提取数量", required: false },
      },
      execute: async (params) => {
        try {
          const inst = await ensureBrowser(config);
          if (!inst) return { success: false, error: "Playwright 未安装" };

          const page = inst.page as any;
          const limit = (params.limit as number) || 50;

          switch (params.type) {
            case "text": {
              const text = await page.evaluate(() => document.body.innerText);
              return { success: true, data: { text: (text as string).slice(0, 5000) } };
            }
            case "links": {
              const links = await page.evaluate((lim: number) => {
                return Array.from(document.querySelectorAll("a[href]"))
                  .slice(0, lim)
                  .map((a: Element) => ({
                    text: (a as HTMLAnchorElement).innerText.trim().slice(0, 100),
                    href: (a as HTMLAnchorElement).href,
                  }));
              }, limit);
              return { success: true, data: { links, count: (links as unknown[]).length } };
            }
            case "images": {
              const images = await page.evaluate((lim: number) => {
                return Array.from(document.querySelectorAll("img[src]"))
                  .slice(0, lim)
                  .map((img: Element) => ({
                    src: (img as HTMLImageElement).src,
                    alt: (img as HTMLImageElement).alt,
                    width: (img as HTMLImageElement).naturalWidth,
                    height: (img as HTMLImageElement).naturalHeight,
                  }));
              }, limit);
              return { success: true, data: { images, count: (images as unknown[]).length } };
            }
            case "meta": {
              const meta = await page.evaluate(() => {
                const getMeta = (name: string) =>
                  document.querySelector(`meta[name="${name}"]`)?.getAttribute("content") ||
                  document.querySelector(`meta[property="${name}"]`)?.getAttribute("content") || "";
                return {
                  title: document.title,
                  description: getMeta("description"),
                  keywords: getMeta("keywords"),
                  ogTitle: getMeta("og:title"),
                  ogDescription: getMeta("og:description"),
                  ogImage: getMeta("og:image"),
                };
              });
              return { success: true, data: meta };
            }
            case "selector": {
              if (!params.selector) return { success: false, error: "selector 参数必填" };
              const attr = (params.attribute as string) || "innerText";
              const results = await page.evaluate(
                ({ sel, attr, lim }: { sel: string; attr: string; lim: number }) => {
                  return Array.from(document.querySelectorAll(sel))
                    .slice(0, lim)
                    .map((el: Element) =>
                      attr === "innerText"
                        ? (el as HTMLElement).innerText?.trim()
                        : el.getAttribute(attr)
                    );
                },
                { sel: params.selector as string, attr, lim: limit }
              );
              return { success: true, data: { results, count: (results as unknown[]).length } };
            }
            default:
              return { success: false, error: `未知提取类型: ${params.type}` };
          }
        } catch (error) {
          return { success: false, error: `提取失败: ${error instanceof Error ? error.message : String(error)}` };
        }
      },
    },

    // ==================== 4. 表单自动填写 ====================
    {
      name: "browser-fill-form",
      description: "自动填写页面表单（支持文本框/下拉框/复选框）",
      category: "workflow",
      parameters: {
        fields: {
          type: "object",
          description: "字段映射: { selector: value, ... }",
          required: true,
        },
        submit: { type: "string", description: "提交按钮选择器", required: false },
      },
      execute: async (params) => {
        try {
          const inst = await ensureBrowser(config);
          if (!inst) return { success: false, error: "Playwright 未安装" };

          const page = inst.page as any;
          const fields = params.fields as Record<string, string>;
          let filled = 0;

          for (const [selector, value] of Object.entries(fields)) {
            try {
              const tagName = await page.evaluate(
                (sel: string) => document.querySelector(sel)?.tagName?.toLowerCase(),
                selector
              );

              if (tagName === "select") {
                await page.selectOption(selector, value);
              } else if (tagName === "input") {
                const inputType = await page.evaluate(
                  (sel: string) => (document.querySelector(sel) as HTMLInputElement)?.type,
                  selector
                );
                if (inputType === "checkbox" || inputType === "radio") {
                  if (value === "true") await page.check(selector);
                  else await page.uncheck(selector);
                } else {
                  await page.fill(selector, value);
                }
              } else {
                await page.fill(selector, value);
              }
              filled++;
            } catch {
              // 跳过无法填写的字段
            }
          }

          // 提交
          if (params.submit) {
            await page.click(params.submit as string);
            await page.waitForLoadState("domcontentloaded");
          }

          return {
            success: true,
            data: { filled, total: Object.keys(fields).length, submitted: !!params.submit },
          };
        } catch (error) {
          return { success: false, error: `表单填写失败: ${error instanceof Error ? error.message : String(error)}` };
        }
      },
    },

    // ==================== 5. 点击操作 ====================
    {
      name: "browser-click",
      description: "点击页面元素",
      category: "workflow",
      parameters: {
        selector: { type: "string", description: "CSS 选择器", required: true },
        waitAfter: { type: "number", description: "点击后等待时间(ms)", required: false },
      },
      execute: async (params) => {
        try {
          const inst = await ensureBrowser(config);
          if (!inst) return { success: false, error: "Playwright 未安装" };

          const page = inst.page as any;
          await page.click(params.selector as string);

          if (params.waitAfter) {
            await page.waitForTimeout(params.waitAfter as number);
          }

          return { success: true, data: { clicked: params.selector } };
        } catch (error) {
          return { success: false, error: `点击失败: ${error instanceof Error ? error.message : String(error)}` };
        }
      },
    },

    // ==================== 6. Cookie 管理 ====================
    {
      name: "browser-cookies",
      description: "获取/设置/保存/加载 Cookie（用于登录态管理）",
      category: "workflow",
      parameters: {
        action: {
          type: "string",
          description: "操作: get/set/save/load",
          required: true,
        },
        path: { type: "string", description: "Cookie 文件路径（save/load 时使用）", required: false },
        cookies: { type: "array", description: "Cookie 列表（set 时使用）", required: false },
      },
      execute: async (params) => {
        try {
          const inst = await ensureBrowser(config);
          if (!inst) return { success: false, error: "Playwright 未安装" };

          const context = inst.context as any;
          const fs = await import("fs");

          switch (params.action) {
            case "get": {
              const cookies = await context.cookies();
              return { success: true, data: { cookies, count: cookies.length } };
            }
            case "set": {
              if (params.cookies) {
                await context.addCookies(params.cookies);
              }
              return { success: true, data: { message: "Cookie 已设置" } };
            }
            case "save": {
              const savePath = (params.path as string) || "/tmp/jarvis-cookies.json";
              const cookies = await context.cookies();
              fs.writeFileSync(savePath, JSON.stringify(cookies, null, 2));
              return { success: true, data: { path: savePath, count: cookies.length } };
            }
            case "load": {
              const loadPath = (params.path as string) || "/tmp/jarvis-cookies.json";
              if (!fs.existsSync(loadPath)) return { success: false, error: `Cookie 文件不存在: ${loadPath}` };
              const raw = fs.readFileSync(loadPath, "utf-8");
              const cookies = JSON.parse(raw);
              await context.addCookies(cookies);
              return { success: true, data: { loaded: cookies.length } };
            }
            default:
              return { success: false, error: `未知操作: ${params.action}` };
          }
        } catch (error) {
          return { success: false, error: `Cookie 操作失败: ${error instanceof Error ? error.message : String(error)}` };
        }
      },
    },

    // ==================== 7. 页面等待 ====================
    {
      name: "browser-wait",
      description: "等待页面元素出现或页面加载完成",
      category: "workflow",
      parameters: {
        selector: { type: "string", description: "等待的选择器", required: false },
        state: { type: "string", description: "等待状态: visible/hidden/attached", required: false },
        timeout: { type: "number", description: "超时(ms)", required: false },
        url: { type: "string", description: "等待 URL 包含此字符串", required: false },
      },
      execute: async (params) => {
        try {
          const inst = await ensureBrowser(config);
          if (!inst) return { success: false, error: "Playwright 未安装" };

          const page = inst.page as any;
          const timeout = (params.timeout as number) || 10000;

          if (params.selector) {
            await page.waitForSelector(params.selector as string, {
              state: params.state || "visible",
              timeout,
            });
            return { success: true, data: { waited: "selector", selector: params.selector } };
          }

          if (params.url) {
            await page.waitForURL(`**${params.url}**`, { timeout });
            return { success: true, data: { waited: "url", url: page.url() } };
          }

          await page.waitForLoadState("networkidle", { timeout });
          return { success: true, data: { waited: "networkidle" } };
        } catch (error) {
          return { success: false, error: `等待超时: ${error instanceof Error ? error.message : String(error)}` };
        }
      },
    },

    // ==================== 8. 执行 JS ====================
    {
      name: "browser-evaluate",
      description: "在页面上下文中执行 JavaScript 代码",
      category: "workflow",
      parameters: {
        script: { type: "string", description: "要执行的 JavaScript 代码", required: true },
      },
      execute: async (params) => {
        try {
          const inst = await ensureBrowser(config);
          if (!inst) return { success: false, error: "Playwright 未安装" };

          const page = inst.page as any;
          const result = await page.evaluate((code: string) => {
            return eval(code);
          }, params.script as string);

          return { success: true, data: { result } };
        } catch (error) {
          return { success: false, error: `JS 执行失败: ${error instanceof Error ? error.message : String(error)}` };
        }
      },
    },

    // ==================== 9. 关闭浏览器 ====================
    {
      name: "browser-close",
      description: "关闭浏览器实例，释放资源",
      category: "workflow",
      parameters: {},
      execute: async () => {
        try {
          if (_instance) {
            await (_instance.browser as any).close();
            _instance = null;
          }
          return { success: true, data: { message: "浏览器已关闭" } };
        } catch (error) {
          _instance = null;
          return { success: false, error: `关闭失败: ${error instanceof Error ? error.message : String(error)}` };
        }
      },
    },

    // ==================== 10. PDF 导出 ====================
    {
      name: "browser-pdf",
      description: "将当前页面导出为 PDF 文件",
      category: "workflow",
      parameters: {
        path: { type: "string", description: "PDF 保存路径", required: true },
        format: { type: "string", description: "纸张大小: A4/Letter/Legal", required: false },
      },
      execute: async (params) => {
        try {
          const inst = await ensureBrowser(config);
          if (!inst) return { success: false, error: "Playwright 未安装" };

          const page = inst.page as any;
          await page.pdf({
            path: params.path as string,
            format: params.format || "A4",
            printBackground: true,
          });

          return { success: true, data: { path: params.path, message: "PDF 已导出" } };
        } catch (error) {
          return { success: false, error: `PDF 导出失败: ${error instanceof Error ? error.message : String(error)}` };
        }
      },
    },
  ];
}
