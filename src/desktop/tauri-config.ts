/**
 * Desktop — Tauri 桌面端配置生成器
 *
 * 生成 Tauri v2 项目配置，将 Web Chat UI 包装为原生桌面应用：
 * - macOS / Windows / Linux 三平台
 * - 系统托盘 + 全局快捷键
 * - 自动检测后端服务
 * - 自启动 + 最小化到托盘
 *
 * 用法：
 *   jarvis-agent desktop init  → 生成 Tauri 项目骨架
 *   jarvis-agent desktop build → 构建桌面安装包
 */

import * as fs from "fs";
import * as path from "path";

// ==================== 类型 ====================

export interface TauriProjectConfig {
  appName: string;
  version: string;
  identifier: string;
  webPort: number;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  resizable: boolean;
  fullscreen: boolean;
  transparent: boolean;
  decorations: boolean;
  alwaysOnTop: boolean;
  systemTray: boolean;
  globalShortcut: string;
}

const DEFAULT_CONFIG: TauriProjectConfig = {
  appName: "Jarvis AI",
  version: "1.0.0",
  identifier: "com.jarvis.agent",
  webPort: 3900,
  width: 1200,
  height: 800,
  minWidth: 400,
  minHeight: 600,
  resizable: true,
  fullscreen: false,
  transparent: false,
  decorations: true,
  alwaysOnTop: false,
  systemTray: true,
  globalShortcut: "CmdOrCtrl+Shift+J",
};

// ==================== 生成器 ====================

export class DesktopBuilder {
  private config: TauriProjectConfig;

  constructor(config?: Partial<TauriProjectConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** 生成 Tauri 项目骨架 */
  generateProject(outputDir: string): { files: string[]; instructions: string } {
    const files: string[] = [];

    // 1. tauri.conf.json
    const tauriConf = this.generateTauriConf();
    const tauriConfPath = path.join(outputDir, "src-tauri", "tauri.conf.json");
    this.writeFile(tauriConfPath, JSON.stringify(tauriConf, null, 2));
    files.push(tauriConfPath);

    // 2. Cargo.toml
    const cargoToml = this.generateCargoToml();
    const cargoPath = path.join(outputDir, "src-tauri", "Cargo.toml");
    this.writeFile(cargoPath, cargoToml);
    files.push(cargoPath);

    // 3. main.rs
    const mainRs = this.generateMainRs();
    const mainRsPath = path.join(outputDir, "src-tauri", "src", "main.rs");
    this.writeFile(mainRsPath, mainRs);
    files.push(mainRsPath);

    // 4. package.json（Tauri CLI 依赖）
    const pkgJson = this.generatePackageJson();
    const pkgPath = path.join(outputDir, "package.json");
    // 只在不存在时创建
    if (!fs.existsSync(pkgPath)) {
      this.writeFile(pkgPath, JSON.stringify(pkgJson, null, 2));
      files.push(pkgPath);
    }

    // 5. 启动脚本
    const startScript = this.generateStartScript();
    const scriptPath = path.join(outputDir, "start-desktop.sh");
    this.writeFile(scriptPath, startScript);
    files.push(scriptPath);

    const instructions = `
桌面端项目已生成！

📁 文件结构:
  ${outputDir}/
  ├── src-tauri/
  │   ├── tauri.conf.json    ← Tauri 配置
  │   ├── Cargo.toml         ← Rust 依赖
  │   └── src/
  │       └── main.rs        ← Rust 入口
  ├── package.json           ← Tauri CLI
  └── start-desktop.sh       ← 一键启动脚本

🚀 快速开始:
  1. 安装 Rust: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  2. cd ${outputDir}
  3. npm install
  4. npm run tauri dev

📦 构建安装包:
  npm run tauri build

⌨️  全局快捷键: ${this.config.globalShortcut}
🖥  窗口大小: ${this.config.width}x${this.config.height}
🔧 系统托盘: ${this.config.systemTray ? "是" : "否"}
`;

    return { files, instructions };
  }

  // ==================== 配置文件生成 ====================

  private generateTauriConf(): Record<string, unknown> {
    return {
      $schema: "https://raw.githubusercontent.com/nicovrc/tauri-apps/tauri-v2/tooling/cli/schema.json",
      productName: this.config.appName,
      version: this.config.version,
      identifier: this.config.identifier,
      build: {
        devUrl: `http://localhost:${this.config.webPort}`,
        frontendDist: `http://localhost:${this.config.webPort}`,
      },
      app: {
        windows: [
          {
            title: this.config.appName,
            width: this.config.width,
            height: this.config.height,
            minWidth: this.config.minWidth,
            minHeight: this.config.minHeight,
            resizable: this.config.resizable,
            fullscreen: this.config.fullscreen,
            transparent: this.config.transparent,
            decorations: this.config.decorations,
            alwaysOnTop: this.config.alwaysOnTop,
            center: true,
          },
        ],
        security: {
          csp: null,
        },
        ...(this.config.systemTray ? {
          trayIcon: {
            id: "main-tray",
            iconPath: "icons/icon.png",
            iconAsTemplate: true,
            menuOnLeftClick: false,
            tooltip: this.config.appName,
          },
        } : {}),
      },
      bundle: {
        active: true,
        targets: "all",
        icon: [
          "icons/32x32.png",
          "icons/128x128.png",
          "icons/128x128@2x.png",
          "icons/icon.icns",
          "icons/icon.ico",
        ],
        macOS: {
          minimumSystemVersion: "10.15",
        },
      },
      plugins: {
        "global-shortcut": {
          shortcuts: [this.config.globalShortcut],
        },
      },
    };
  }

  private generateCargoToml(): string {
    return `[package]
name = "jarvis-agent-desktop"
version = "${this.config.version}"
description = "${this.config.appName} Desktop"
edition = "2021"

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-global-shortcut = "2"
tauri-plugin-shell = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
`;
  }

  private generateMainRs(): string {
    return `// Jarvis Agent Desktop — Tauri v2 入口

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // 系统托盘点击：显示/隐藏窗口
            #[cfg(desktop)]
            {
                let window = app.get_webview_window("main").unwrap();
                let window_clone = window.clone();

                app.on_tray_icon_event(move |_app, event| {
                    match event {
                        tauri::tray::TrayIconEvent::Click { .. } => {
                            if window_clone.is_visible().unwrap_or(false) {
                                let _ = window_clone.hide();
                            } else {
                                let _ = window_clone.show();
                                let _ = window_clone.set_focus();
                            }
                        }
                        _ => {}
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
`;
  }

  private generatePackageJson(): Record<string, unknown> {
    return {
      name: "jarvis-agent-desktop",
      version: this.config.version,
      private: true,
      scripts: {
        "tauri": "tauri",
        "tauri:dev": "tauri dev",
        "tauri:build": "tauri build",
      },
      devDependencies: {
        "@tauri-apps/cli": "^2",
      },
    };
  }

  private generateStartScript(): string {
    return `#!/bin/bash
# Jarvis Agent Desktop — 一键启动
# 先启动后端 Web Chat 服务，再启动 Tauri 桌面端

set -e

echo "🚀 启动 Jarvis Agent..."

# 1. 启动 Web Chat Server
echo "  → 启动 Web Chat (port ${this.config.webPort})..."
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
`;
  }

  // ==================== 辅助 ====================

  private writeFile(filePath: string, content: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
  }

  /** 获取配置 */
  getConfig(): TauriProjectConfig {
    return this.config;
  }
}
