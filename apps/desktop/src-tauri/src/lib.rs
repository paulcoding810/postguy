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

fn sidecar_script(app: &tauri::AppHandle) -> Option<PathBuf> {
    if std::env::var("POSTGUY_SERVER_URL").is_ok() {
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
    let mut child = Command::new(&node)
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let sidecar = Arc::new(Sidecar::default());
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(sidecar.clone())
        .setup({
            let sidecar = sidecar.clone();
            move |app| {
                if let Some(script) = sidecar_script(app.handle()) {
                    if let Err(e) = start_sidecar(app.handle(), script, sidecar.clone()) {
                        set_info(&sidecar, Err(e));
                    }
                }
                Ok(())
            }
        })
        .invoke_handler(tauri::generate_handler![server_info, save_text_file])
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
