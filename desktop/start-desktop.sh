#!/bin/bash
# Jarvis Agent Desktop — 一键启动
# 先启动后端 Web Chat 服务，再启动 Tauri 桌面端

set -e

echo "🚀 启动 Jarvis Agent..."

# 1. 启动 Web Chat Server
echo "  → 启动 Web Chat (port 3800)..."
cd "$(dirname "$0")/.."
npx tsx src/cli/bin.ts web &
WEB_PID=$!

# 等待服务就绪
sleep 2

# 2. 启动 Tauri 桌面端
echo "  → 启动桌面应用..."
cd "$(dirname "$0")"
npm run tauri:dev

# 清理
kill $WEB_PID 2>/dev/null
echo "✅ 已关闭"
