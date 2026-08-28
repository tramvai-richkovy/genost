use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::Manager;

struct WorkerProcess {
    child: Arc<Mutex<Option<Child>>>,
    shutting_down: Arc<AtomicBool>,
}

impl WorkerProcess {
    fn start(app: tauri::AppHandle) -> Self {
        let child = Arc::new(Mutex::new(start_worker(&app)));
        let shutting_down = Arc::new(AtomicBool::new(false));
        let monitored_child = Arc::clone(&child);
        let monitor_shutdown = Arc::clone(&shutting_down);

        thread::spawn(move || loop {
            thread::sleep(Duration::from_secs(1));
            if monitor_shutdown.load(Ordering::Acquire) {
                break;
            }

            let should_restart = match monitored_child.lock() {
                Ok(mut worker) => match worker.as_mut() {
                    Some(process) => match process.try_wait() {
                        Ok(Some(status)) => {
                            eprintln!("GENOST worker exited unexpectedly: {status}");
                            *worker = None;
                            true
                        }
                        Ok(None) => false,
                        Err(error) => {
                            eprintln!("GENOST worker status check failed: {error}");
                            *worker = None;
                            true
                        }
                    },
                    None => true,
                },
                Err(error) => {
                    eprintln!("GENOST worker monitor lock failed: {error}");
                    false
                }
            };

            if !should_restart || monitor_shutdown.load(Ordering::Acquire) {
                continue;
            }

            thread::sleep(Duration::from_secs(1));
            if monitor_shutdown.load(Ordering::Acquire) {
                break;
            }

            let restarted = start_worker(&app);
            if let Ok(mut worker) = monitored_child.lock() {
                if monitor_shutdown.load(Ordering::Acquire) {
                    if let Some(mut process) = restarted {
                        let _ = process.kill();
                        let _ = process.wait();
                    }
                    break;
                }
                if restarted.is_some() {
                    eprintln!("GENOST worker restarted after unexpected exit");
                }
                *worker = restarted;
            }
        });

        Self {
            child,
            shutting_down,
        }
    }
}

impl Drop for WorkerProcess {
    fn drop(&mut self) {
        self.shutting_down.store(true, Ordering::Release);
        if let Ok(mut worker) = self.child.lock() {
            if let Some(child) = worker.as_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
            *worker = None;
        }
    }
}

fn repository_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

fn worker_executable(app: &tauri::AppHandle) -> Option<(PathBuf, bool)> {
    if let Ok(configured) = std::env::var("GENOST_WORKER_BIN") {
        let path = PathBuf::from(configured);
        if path.is_file() {
            return Some((path, false));
        }
    }

    let root = repository_root();
    if cfg!(debug_assertions) {
        let python = root.join(".venv/bin/python");
        if python.is_file() {
            return Some((python, true));
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

    if let Ok(resources) = app.path().resource_dir() {
        for name in ["genost-worker", "genost-worker-aarch64-apple-darwin"] {
            let path = resources.join(name);
            if path.is_file() {
                return Some((path, false));
            }
        }
    }

    let frozen = root.join("apps/desktop/src-tauri/binaries/genost-worker-aarch64-apple-darwin");
    if frozen.is_file() {
        return Some((frozen, false));
    }
    let python = root.join(".venv/bin/python");
    python.is_file().then_some((python, true))
}

fn start_worker(app: &tauri::AppHandle) -> Option<Child> {
    let root = repository_root();
    let Some((executable, is_python)) = worker_executable(app) else {
        eprintln!(
            "GENOST worker not started: no development environment or packaged sidecar found"
        );
        return None;
    };
    let parent_pid = std::process::id().to_string();
    let mut command = Command::new(&executable);
    if is_python {
        command.args(["-m", "genost_worker.server"]);
    }

    let working_directory = if is_python {
        root
    } else {
        executable.parent().unwrap_or(Path::new(".")).to_path_buf()
    };

    match command
        .args([
            "--parent-pid",
            &parent_pid,
            "--host",
            "127.0.0.1",
            "--port",
            "8765",
        ])
        .current_dir(working_directory)
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
            app.manage(WorkerProcess::start(app.handle().clone()));
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
