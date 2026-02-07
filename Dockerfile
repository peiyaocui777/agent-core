FROM node:20-slim

WORKDIR /app

# Playwright 浏览器依赖（可选，如需 BrowserPilot）
# RUN apt-get update && apt-get install -y \
#     libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libgbm1 \
#     libpango-1.0-0 libcairo2 libasound2 libxshmfence1 \
#     && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --production 2>/dev/null || npm install --production

COPY dist/ ./dist/

# 配置文件（用户挂载）
COPY jarvis.config.yaml* ./

ENV NODE_ENV=production
EXPOSE 3800 3900

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3900/api/status', r => { process.exit(r.statusCode === 200 ? 0 : 1) })"

CMD ["node", "dist/main.js"]
