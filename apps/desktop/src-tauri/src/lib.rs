use serde::Serialize;
use tauri_plugin_dialog::DialogExt;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerInfo {
    base_url: String,
    token: String,
}

/// Connection details of the local Postguy server.
#[tauri::command]
fn server_info() -> ServerInfo {
    ServerInfo {
        base_url: std::env::var("POSTGUY_SERVER_URL").unwrap_or_else(|_| "http://127.0.0.1:4777".into()),
        token: std::env::var("POSTGUY_TOKEN").unwrap_or_else(|_| "dev-token".into()),
    }
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
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![server_info, save_text_file])
        .run(tauri::generate_context!())
        .expect("error while running Postguy");
}
