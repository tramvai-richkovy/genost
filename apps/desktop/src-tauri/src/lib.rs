use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::Manager;

struct WorkerProcess(Mutex<Option<Child>>);

impl Drop for WorkerProcess {
    fn drop(&mut self) {
        if let Ok(worker) = self.0.get_mut() {
            if let Some(child) = worker.as_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

fn repository_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

fn worker_executable() -> Option<(PathBuf, bool)> {
    if let Ok(configured) = std::env::var("GENOST_WORKER_BIN") {
        let path = PathBuf::from(configured);
        if path.is_file() {
            return Some((path, false));
        }
    }

    if let Ok(current) = std::env::current_exe() {
        if let Some(directory) = current.parent() {
            for name in ["genost-worker", "genost-worker-aarch64-apple-darwin"] {
                let path = directory.join(name);
                if path.is_file() {
                    return Some((path, false));
                }
            }
        }
    }

    let root = repository_root();
    let frozen = root.join("apps/desktop/src-tauri/binaries/genost-worker-aarch64-apple-darwin");
    if frozen.is_file() {
        return Some((frozen, false));
    }
    let python = root.join(".venv/bin/python");
    python.is_file().then_some((python, true))
}

fn start_worker() -> Option<Child> {
    let root = repository_root();
    let Some((executable, is_python)) = worker_executable() else {
        eprintln!("GENOST worker not started: no development environment or packaged sidecar found");
        return None;
    };
    let parent_pid = std::process::id().to_string();
    let mut command = Command::new(&executable);
    if is_python {
        command.args(["-m", "genost_worker.server"]);
    }

    match command
        .args([
            "--parent-pid",
            &parent_pid,
            "--host",
            "127.0.0.1",
            "--port",
            "8765",
        ])
        .current_dir(&root)
        .env("PYTHONUNBUFFERED", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
    {
        Ok(child) => Some(child),
        Err(error) => {
            eprintln!("GENOST worker failed to start: {error}");
            None
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            app.manage(WorkerProcess(Mutex::new(start_worker())));
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
