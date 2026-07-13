use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashSet,
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct JavaRuntime {
    path: String,
    version: String,
    source: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlatformEnvironment {
    platform: String,
    default_game_directory: String,
    total_memory_mb: u64,
    java_runtimes: Vec<JavaRuntime>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalModFile {
    name: String,
    path: String,
    size_kb: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LauncherProfile {
    name: String,
    version: String,
    loader: String,
    memory_mb: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LauncherSettings {
    game_directory: String,
    java_path: String,
    memory_mb: u64,
    resolution_width: u32,
    resolution_height: u32,
    launch_arguments: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PreflightCheck {
    label: String,
    passed: bool,
    detail: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PreflightReport {
    ready: bool,
    command_preview: String,
    checks: Vec<PreflightCheck>,
}

fn state_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join("launcher-state.json"))
        .map_err(|error| format!("Unable to resolve app data directory: {error}"))
}

#[tauri::command]
fn load_state(app: AppHandle) -> Result<Option<Value>, String> {
    let path = state_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }

    let contents = fs::read_to_string(path)
        .map_err(|error| format!("Unable to read launcher state: {error}"))?;
    let state = serde_json::from_str(&contents)
        .map_err(|error| format!("Unable to parse launcher state: {error}"))?;
    Ok(Some(state))
}

#[tauri::command]
fn save_state(app: AppHandle, state: Value) -> Result<(), String> {
    let path = state_path(&app)?;
    let directory = path
        .parent()
        .ok_or_else(|| "Launcher state path has no parent directory".to_string())?;
    fs::create_dir_all(directory)
        .map_err(|error| format!("Unable to create app data directory: {error}"))?;
    let contents = serde_json::to_string_pretty(&state)
        .map_err(|error| format!("Unable to serialize launcher state: {error}"))?;
    fs::write(path, contents).map_err(|error| format!("Unable to save launcher state: {error}"))
}

fn default_game_directory() -> String {
    if cfg!(target_os = "windows") {
        return env::var("APPDATA")
            .map(|path| PathBuf::from(path).join(".minecraft"))
            .unwrap_or_else(|_| PathBuf::from(".minecraft"))
            .to_string_lossy()
            .into_owned();
    }

    let home = env::var("HOME").unwrap_or_default();
    if cfg!(target_os = "macos") {
        return PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("minecraft")
            .to_string_lossy()
            .into_owned();
    }

    PathBuf::from(home)
        .join(".minecraft")
        .to_string_lossy()
        .into_owned()
}

fn java_version(path: &Path) -> Option<String> {
    let output = Command::new(path).arg("-version").output().ok()?;
    let version_output = if output.stderr.is_empty() {
        String::from_utf8_lossy(&output.stdout)
    } else {
        String::from_utf8_lossy(&output.stderr)
    };
    let first_line = version_output.lines().next()?.trim();
    let quoted = first_line.split('"').nth(1);
    Some(quoted.unwrap_or(first_line).to_string())
}

fn add_java_candidate(
    runtimes: &mut Vec<JavaRuntime>,
    seen: &mut HashSet<PathBuf>,
    path: PathBuf,
    source: &str,
) {
    if !path.is_file() {
        return;
    }

    let canonical = fs::canonicalize(path).unwrap_or_default();
    if canonical.as_os_str().is_empty() || !seen.insert(canonical.clone()) {
        return;
    }

    if let Some(version) = java_version(&canonical) {
        runtimes.push(JavaRuntime {
            path: canonical.to_string_lossy().into_owned(),
            version,
            source: source.to_string(),
        });
    }
}

fn detect_java_runtimes() -> Vec<JavaRuntime> {
    let executable = if cfg!(target_os = "windows") {
        "java.exe"
    } else {
        "java"
    };
    let mut runtimes = Vec::new();
    let mut seen = HashSet::new();

    if let Ok(java_home) = env::var("JAVA_HOME") {
        add_java_candidate(
            &mut runtimes,
            &mut seen,
            PathBuf::from(java_home).join("bin").join(executable),
            "JAVA_HOME",
        );
    }

    if let Some(path_variable) = env::var_os("PATH") {
        for directory in env::split_paths(&path_variable) {
            add_java_candidate(&mut runtimes, &mut seen, directory.join(executable), "PATH");
        }
    }

    runtimes
}

fn total_memory_mb() -> u64 {
    if cfg!(target_os = "linux") {
        return fs::read_to_string("/proc/meminfo")
            .ok()
            .and_then(|contents| {
                contents.lines().find_map(|line| {
                    let value = line.strip_prefix("MemTotal:")?;
                    value
                        .split_whitespace()
                        .next()?
                        .parse::<u64>()
                        .ok()
                        .map(|kilobytes| kilobytes / 1024)
                })
            })
            .unwrap_or(8192);
    }

    if cfg!(target_os = "macos") {
        return Command::new("sysctl")
            .args(["-n", "hw.memsize"])
            .output()
            .ok()
            .and_then(|output| String::from_utf8(output.stdout).ok())
            .and_then(|bytes| bytes.trim().parse::<u64>().ok())
            .map(|bytes| bytes / 1024 / 1024)
            .unwrap_or(8192);
    }

    if cfg!(target_os = "windows") {
        return Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory",
            ])
            .output()
            .ok()
            .and_then(|output| String::from_utf8(output.stdout).ok())
            .and_then(|bytes| bytes.trim().parse::<u64>().ok())
            .map(|bytes| bytes / 1024 / 1024)
            .unwrap_or(8192);
    }

    8192
}

#[tauri::command]
fn get_environment() -> PlatformEnvironment {
    PlatformEnvironment {
        platform: format!("{} {}", env::consts::OS, env::consts::ARCH),
        default_game_directory: default_game_directory(),
        total_memory_mb: total_memory_mb(),
        java_runtimes: detect_java_runtimes(),
    }
}

#[tauri::command]
fn scan_local_mods(game_directory: String) -> Result<Vec<LocalModFile>, String> {
    let mods_directory = PathBuf::from(game_directory).join("mods");
    if !mods_directory.is_dir() {
        return Ok(Vec::new());
    }

    let entries = fs::read_dir(&mods_directory)
        .map_err(|error| format!("Unable to read {}: {error}", mods_directory.display()))?;
    let mut mods = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|error| format!("Unable to read mod entry: {error}"))?;
        let path = entry.path();
        let is_jar = path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("jar"));
        if !is_jar {
            continue;
        }

        let metadata = entry
            .metadata()
            .map_err(|error| format!("Unable to inspect {}: {error}", path.display()))?;
        mods.push(LocalModFile {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: path.to_string_lossy().into_owned(),
            size_kb: metadata.len().div_ceil(1024),
        });
    }

    mods.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    Ok(mods)
}

fn check(label: &str, passed: bool, detail: String) -> PreflightCheck {
    PreflightCheck {
        label: label.to_string(),
        passed,
        detail,
    }
}

#[tauri::command]
fn run_preflight(
    profile: LauncherProfile,
    settings: LauncherSettings,
    account_connected: bool,
) -> PreflightReport {
    let java_exists = Path::new(&settings.java_path).is_file();
    let game_directory_exists = Path::new(&settings.game_directory).is_dir();
    let memory_valid =
        (2048..=total_memory_mb().saturating_sub(1024)).contains(&settings.memory_mb);
    let resolution_valid = settings.resolution_width >= 640 && settings.resolution_height >= 480;

    let checks = vec![
        check(
            "Microsoft account",
            account_connected,
            if account_connected {
                "Licensed Microsoft session is available.".to_string()
            } else {
                "Connect a licensed Microsoft account using OAuth PKCE.".to_string()
            },
        ),
        check(
            "Java runtime",
            java_exists,
            if java_exists {
                settings.java_path.clone()
            } else {
                "Choose a valid Java executable.".to_string()
            },
        ),
        check(
            "Game directory",
            game_directory_exists,
            if game_directory_exists {
                settings.game_directory.clone()
            } else {
                "Choose an existing Minecraft game directory.".to_string()
            },
        ),
        check(
            "Memory allocation",
            memory_valid,
            format!(
                "{} MB allocated for profile target {} MB.",
                settings.memory_mb, profile.memory_mb
            ),
        ),
        check(
            "Window resolution",
            resolution_valid,
            format!(
                "{} × {}",
                settings.resolution_width, settings.resolution_height
            ),
        ),
    ];
    let ready = checks.iter().all(|item| item.passed);
    let loader = if profile.loader == "Vanilla" {
        String::new()
    } else {
        format!(" --loader {}", profile.loader.to_lowercase())
    };
    let arguments = settings.launch_arguments.trim();
    let command_preview = format!(
        "\"{}\" -Xmx{}M {} … --version {}{} --profile \"{}\"",
        settings.java_path, settings.memory_mb, arguments, profile.version, loader, profile.name
    );

    PreflightReport {
        ready,
        command_preview,
        checks,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            load_state,
            save_state,
            get_environment,
            scan_local_mods,
            run_preflight
        ])
        .run(tauri::generate_context!())
        .expect("error while running Feather Client");
}
