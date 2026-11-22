use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;
use tauri::{Manager, RunEvent};
use tauri_plugin_dialog::DialogExt;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerInfo {
    base_url: String,
    token: String,
}

/// The bundled Node server: its connection details once ready, and the child process.
#[derive(Default)]
struct Sidecar {
    info: Mutex<Option<Result<ServerInfo, String>>>,
    ready: Condvar,
    child: Mutex<Option<Child>>,
}

fn dev_server_info() -> ServerInfo {
    ServerInfo {
        base_url: std::env::var("POSTGUY_SERVER_URL").unwrap_or_else(|_| "http://127.0.0.1:4777".into()),
        token: std::env::var("POSTGUY_TOKEN").unwrap_or_else(|_| "dev-token".into()),
    }
}

/// The bundled server, in built apps only: `tauri dev` always uses the dev server, even when a
/// local `tauri build --debug` left a bundled server next to the dev binary.
fn sidecar_script(app: &tauri::AppHandle) -> Option<PathBuf> {
    if tauri::is_dev() || std::env::var("POSTGUY_SERVER_URL").is_ok() {
        return None;
    }
    let script = app.path().resource_dir().ok()?.join("server").join("server.mjs");
    script.exists().then_some(script)
}

fn set_info(state: &Sidecar, value: Result<ServerInfo, String>) {
    let mut info = state.info.lock().unwrap();
    if info.is_none() {
        *info = Some(value);
        state.ready.notify_all();
    }
}

/// Starts `node server.mjs` on a free port and reads its one-line JSON handshake.
fn start_sidecar(app: &tauri::AppHandle, script: PathBuf, state: Arc<Sidecar>) -> Result<(), String> {
    let exe_dir = std::env::current_exe().map_err(|e| e.to_string())?;
    let node = exe_dir
        .parent()
        .ok_or("no executable directory")?
        .join(if cfg!(windows) { "node.exe" } else { "node" });
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let log = std::fs::File::create(data_dir.join("server.log")).map_err(|e| e.to_string())?;
    let mut command = Command::new(&node);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: no console window for the background server.
        command.creation_flags(0x0800_0000);
    }
    let mut child = command
        .arg(&script)
        .args(["--port", "0", "--parent-pid", &std::process::id().to_string(), "--data-dir"])
        .arg(&data_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::from(log))
        .spawn()
        .map_err(|e| format!("could not start {}: {e}", node.display()))?;
    let stdout = child.stdout.take().ok_or("no server output")?;
    *state.child.lock().unwrap() = Some(child);
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
            if v["event"] == "ready" {
                let port = v["port"].as_u64().unwrap_or(0);
                let token = v["token"].as_str().unwrap_or_default().to_string();
                set_info(&state, Ok(ServerInfo { base_url: format!("http://127.0.0.1:{port}"), token }));
            }
        }
        set_info(&state, Err("The Postguy server stopped before it was ready; see server.log in the app data folder".into()));
    });
    Ok(())
}

/// Connection details of the local Postguy server.
#[tauri::command]
async fn server_info(app: tauri::AppHandle, state: tauri::State<'_, Arc<Sidecar>>) -> Result<ServerInfo, String> {
    if sidecar_script(&app).is_none() {
        return Ok(dev_server_info());
    }
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let guard = state.info.lock().unwrap();
        let (guard, _) = state
            .ready
            .wait_timeout_while(guard, Duration::from_secs(30), |i| i.is_none())
            .unwrap();
        guard.clone().unwrap_or_else(|| Err("Timed out waiting for the Postguy server".into()))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Asks the user for a destination and writes the text there; returns false when cancelled.
#[tauri::command]
async fn save_text_file(app: tauri::AppHandle, file_name: String, contents: String) -> Result<bool, String> {
    let Some(path) = app.dialog().file().set_file_name(&file_name).blocking_save_file() else {
        return Ok(false);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(path, contents).map_err(|e| e.to_string())?;
    Ok(true)
}

/// Asks the user for a file to send and returns its path; None when cancelled.
#[tauri::command]
async fn pick_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let Some(path) = app.dialog().file().blocking_pick_file() else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Adds "Check for Updates…" and "Settings…" under the app menu; the window handles both.
#[cfg(target_os = "macos")]
fn add_update_menu_item(app: &mut tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, MenuItemKind};
    use tauri::Emitter;
    let menu = Menu::default(app.handle())?;
    if let Some(MenuItemKind::Submenu(app_menu)) = menu.items()?.into_iter().next() {
        let item = MenuItem::with_id(app, "check-updates", "Check for Updates…", true, None::<&str>)?;
        app_menu.insert(&item, 1)?;
        let settings = MenuItem::with_id(app, "open-settings", "Settings…", true, Some("CmdOrCtrl+,"))?;
        app_menu.insert(&settings, 2)?;
    }
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        let id = event.id().as_ref();
        if id == "check-updates" || id == "open-settings" {
            let _ = app.emit(id, ());
        }
    });
    Ok(())
}

/// Whether this build can update itself: release builds with an updater key, and on Linux only the AppImage.
#[tauri::command]
fn update_support(app: tauri::AppHandle) -> serde_json::Value {
    let enabled = app.config().plugins.0.contains_key("updater");
    let can_install = !cfg!(target_os = "linux") || std::env::var_os("APPIMAGE").is_some();
    serde_json::json!({ "enabled": enabled, "canInstall": can_install })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let sidecar = Arc::new(Sidecar::default());
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .manage(sidecar.clone())
        .setup({
            let sidecar = sidecar.clone();
            move |app| {
                #[cfg(desktop)]
                if app.config().plugins.0.contains_key("updater") {
                    app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
                }
                #[cfg(target_os = "macos")]
                add_update_menu_item(app)?;
                if let Some(script) = sidecar_script(app.handle()) {
                    if let Err(e) = start_sidecar(app.handle(), script, sidecar.clone()) {
                        set_info(&sidecar, Err(e));
                    }
                }
                Ok(())
            }
        })
        .invoke_handler(tauri::generate_handler![server_info, save_text_file, pick_file, update_support])
        .build(tauri::generate_context!())
        .expect("error while building Postguy");
    app.run(move |_, event| {
        if let RunEvent::Exit = event {
            if let Some(mut child) = sidecar.child.lock().unwrap().take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    });
}
