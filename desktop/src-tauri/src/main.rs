// Jarvis Agent Desktop — Tauri v2 入口

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
