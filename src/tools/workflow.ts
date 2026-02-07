/**
 * 工作流和基础设施相关工具
 */

import type { Tool, AgentConfig } from "../types.js";

export function createWorkflowTools(config: AgentConfig): Tool[] {
  const trendUrl = config.trendApiUrl || "http://127.0.0.1:3001";

  return [
    {
      name: "trigger-workflow",
      description: "触发 AI Trend Publish 自动工作流（热点采集 → 生成 → 发布）",
      category: "workflow",
      parameters: {
        workflowType: { type: "string", description: "工作流类型: daily / weekly / custom", required: true },
      },
      execute: async (params) => {
        try {
          const res = await fetch(`${trendUrl}/api/workflow`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              method: "triggerWorkflow",
              params: { workflowType: params.workflowType },
              id: Date.now().toString(),
            }),
          });

          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          return { success: true, data };
        } catch (error) {
          return {
            success: false,
            error: `工作流触发失败 (ai-trend-publish ${trendUrl}): ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    },

    {
      name: "upload-image",
      description: "上传图片到图床 (CloudFlare-ImgBed)",
      category: "infra",
      parameters: {
        imageUrl: { type: "string", description: "图片 URL 或 base64", required: true },
        filename: { type: "string", description: "文件名", required: false },
      },
      execute: async (params) => {
        const imgBedUrl = config.imgBedUrl || "https://img.example.com";

        // CloudFlare-ImgBed 上传 API
        try {
          const formData = new FormData();

          if (typeof params.imageUrl === "string" && (params.imageUrl as string).startsWith("http")) {
            // URL 模式：先下载再上传
            const imgRes = await fetch(params.imageUrl as string);
            const blob = await imgRes.blob();
            formData.append("file", blob, (params.filename as string) || "image.png");
          } else {
            // Base64 模式
            const base64 = params.imageUrl as string;
            const binaryStr = atob(base64);
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) {
              bytes[i] = binaryStr.charCodeAt(i);
            }
            const blob = new Blob([bytes], { type: "image/png" });
            formData.append("file", blob, (params.filename as string) || "image.png");
          }

          const res = await fetch(`${imgBedUrl}/upload`, {
            method: "POST",
            body: formData,
          });

          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json() as Array<{ src: string }>;
          return {
            success: true,
            data: {
              cdnUrl: data[0]?.src,
              imgBedUrl,
            },
          };
        } catch (error) {
          return {
            success: false,
            error: `图片上传失败: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    },
  ];
}
