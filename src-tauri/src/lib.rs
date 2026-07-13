use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256, Sha512};
use std::{
    collections::{HashMap, HashSet},
    env, fs,
    fs::File,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};
use tauri::{AppHandle, Manager};

#[derive(Debug, Deserialize, Serialize)]
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

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct MinecraftVersion {
    id: String,
    #[serde(rename = "type")]
    version_type: String,
    release_time: String,
}

#[derive(Debug, Deserialize)]
struct MinecraftVersionManifest {
    versions: Vec<MinecraftVersion>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModrinthProject {
    #[serde(rename = "projectId", alias = "project_id")]
    project_id: String,
    title: String,
    description: String,
    #[serde(rename = "iconUrl", alias = "icon_url")]
    icon_url: Option<String>,
    downloads: u64,
}

#[derive(Debug, Deserialize)]
struct ModrinthSearchResponse {
    hits: Vec<ModrinthProject>,
}

#[derive(Debug, Deserialize)]
struct ModrinthVersion {
    files: Vec<ModrinthFile>,
}

#[derive(Debug, Deserialize)]
struct ModrinthFile {
    hashes: HashMap<String, String>,
    url: String,
    filename: String,
    primary: bool,
    size: u64,
}

#[derive(Debug, Deserialize)]
struct AdoptiumAsset {
    binary: AdoptiumBinary,
}

#[derive(Debug, Deserialize)]
struct AdoptiumBinary {
    package: AdoptiumPackage,
}

#[derive(Debug, Deserialize)]
struct AdoptiumPackage {
    checksum: String,
    link: String,
    name: String,
    size: u64,
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

fn http_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent("RuinClient/0.1.0 (contact: sykiiplayz@gmail.com)")
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|error| format!("Unable to initialize secure HTTP client: {error}"))
}

fn java_major(version: &str) -> Option<u32> {
    let cleaned = version
        .trim_start_matches("openjdk version ")
        .trim_matches('"');
    let mut parts = cleaned.split(['.', '_']);
    let first = parts.next()?.parse::<u32>().ok()?;
    if first == 1 {
        parts.next()?.parse::<u32>().ok()
    } else {
        Some(first)
    }
}

fn required_java_major(minecraft_version: &str) -> u32 {
    let release = minecraft_version
        .split('-')
        .next()
        .unwrap_or(minecraft_version);
    let parts = release
        .split('.')
        .filter_map(|part| part.parse::<u32>().ok())
        .collect::<Vec<_>>();

    if parts.first().copied().unwrap_or_default() > 1 {
        return 21;
    }

    let minor = parts.get(1).copied().unwrap_or_default();
    let patch = parts.get(2).copied().unwrap_or_default();
    if minor > 20 || (minor == 20 && patch >= 5) {
        21
    } else if minor >= 18 {
        17
    } else if minor == 17 {
        16
    } else {
        8
    }
}

fn compatible_java_runtime(path: &Path, required_major: u32, source: &str) -> Option<JavaRuntime> {
    let version = java_version(path)?;
    if java_major(&version)? < required_major {
        return None;
    }

    Some(JavaRuntime {
        path: path.to_string_lossy().into_owned(),
        version,
        source: source.to_string(),
    })
}

fn find_java_executable(directory: &Path) -> Option<PathBuf> {
    let executable = if cfg!(target_os = "windows") {
        "java.exe"
    } else {
        "java"
    };
    let mut directories = vec![(directory.to_path_buf(), 0_u8)];

    while let Some((current, depth)) = directories.pop() {
        if depth > 5 {
            continue;
        }
        for entry in fs::read_dir(current).ok()?.flatten() {
            let path = entry.path();
            if path.is_dir() {
                directories.push((path, depth + 1));
            } else if path.file_name().and_then(|name| name.to_str()) == Some(executable)
                && path
                    .parent()
                    .and_then(Path::file_name)
                    .and_then(|name| name.to_str())
                    == Some("bin")
            {
                return Some(path);
            }
        }
    }

    None
}

fn download_to_file(
    client: &reqwest::blocking::Client,
    url: &str,
    destination: &Path,
    expected_size: u64,
) -> Result<String, String> {
    let mut response = client
        .get(url)
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .map_err(|error| format!("Download failed: {error}"))?;
    let mut file = File::create(destination)
        .map_err(|error| format!("Unable to create {}: {error}", destination.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    let mut downloaded = 0_u64;

    loop {
        let count = response
            .read(&mut buffer)
            .map_err(|error| format!("Unable to read download: {error}"))?;
        if count == 0 {
            break;
        }
        downloaded = downloaded.saturating_add(count as u64);
        if downloaded > expected_size {
            return Err("Java runtime download exceeded its declared size.".to_string());
        }
        file.write_all(&buffer[..count])
            .map_err(|error| format!("Unable to write download: {error}"))?;
        hasher.update(&buffer[..count]);
    }
    if downloaded != expected_size {
        return Err("Java runtime download was incomplete.".to_string());
    }

    Ok(format!("{:x}", hasher.finalize()))
}

fn extract_java_archive(archive: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination)
        .map_err(|error| format!("Unable to create runtime directory: {error}"))?;

    let status = if cfg!(target_os = "windows") {
        Command::new("powershell")
            .args(["-NoProfile", "-Command", "Expand-Archive"])
            .arg("-LiteralPath")
            .arg(archive)
            .arg("-DestinationPath")
            .arg(destination)
            .arg("-Force")
            .status()
    } else {
        Command::new("tar")
            .arg("-xzf")
            .arg(archive)
            .arg("-C")
            .arg(destination)
            .status()
    }
    .map_err(|error| format!("Unable to start Java archive extraction: {error}"))?;

    if status.success() {
        Ok(())
    } else {
        Err("Java archive extraction failed.".to_string())
    }
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
fn fetch_minecraft_versions() -> Result<Vec<MinecraftVersion>, String> {
    let manifest = http_client()?
        .get("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json")
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .map_err(|error| format!("Unable to load Minecraft versions: {error}"))?
        .json::<MinecraftVersionManifest>()
        .map_err(|error| format!("Invalid Minecraft version manifest: {error}"))?;

    Ok(manifest.versions)
}

#[tauri::command]
fn ensure_java_runtime(
    app: AppHandle,
    minecraft_version: String,
    configured_java_path: String,
) -> Result<JavaRuntime, String> {
    let required_major = required_java_major(&minecraft_version);
    let configured_path = PathBuf::from(configured_java_path);
    if configured_path.is_file() {
        if let Some(runtime) =
            compatible_java_runtime(&configured_path, required_major, "Configured runtime")
        {
            return Ok(runtime);
        }
    }

    if let Some(runtime) = detect_java_runtimes()
        .into_iter()
        .find(|runtime| java_major(&runtime.version).is_some_and(|major| major >= required_major))
    {
        return Ok(runtime);
    }

    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve app data directory: {error}"))?;
    let runtime_root = app_data
        .join("runtimes")
        .join(format!("temurin-{required_major}"));
    let current_directory = runtime_root.join("current");
    if let Some(path) = find_java_executable(&current_directory) {
        if let Some(runtime) =
            compatible_java_runtime(&path, required_major, "Ruin managed runtime")
        {
            return Ok(runtime);
        }
    }

    let operating_system = match env::consts::OS {
        "windows" => "windows",
        "macos" => "mac",
        "linux" => "linux",
        other => return Err(format!("Automatic Java setup is unavailable on {other}.")),
    };
    let architecture = match env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "aarch64",
        other => {
            return Err(format!(
                "Automatic Java setup is unavailable for architecture {other}."
            ))
        }
    };
    let client = http_client()?;
    let metadata_url = format!(
        "https://api.adoptium.net/v3/assets/latest/{required_major}/hotspot?architecture={architecture}&image_type=jre&os={operating_system}&vendor=eclipse"
    );
    let asset = client
        .get(metadata_url)
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .map_err(|error| format!("Unable to locate a Java runtime: {error}"))?
        .json::<Vec<AdoptiumAsset>>()
        .map_err(|error| format!("Invalid Java runtime metadata: {error}"))?
        .into_iter()
        .next()
        .ok_or_else(|| format!("No Temurin Java {required_major} runtime is available."))?;
    let archive_name = Path::new(&asset.binary.package.name)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| *name == asset.binary.package.name.as_str())
        .ok_or_else(|| "Java provider returned an invalid archive name.".to_string())?;

    fs::create_dir_all(&runtime_root)
        .map_err(|error| format!("Unable to create runtime directory: {error}"))?;
    let archive_path = runtime_root.join(archive_name);
    let staging_directory = runtime_root.join("extracting");
    if staging_directory.exists() {
        fs::remove_dir_all(&staging_directory)
            .map_err(|error| format!("Unable to reset runtime staging directory: {error}"))?;
    }

    let checksum = match download_to_file(
        &client,
        &asset.binary.package.link,
        &archive_path,
        asset.binary.package.size,
    ) {
        Ok(checksum) => checksum,
        Err(error) => {
            let _ = fs::remove_file(&archive_path);
            return Err(error);
        }
    };
    if !checksum.eq_ignore_ascii_case(&asset.binary.package.checksum) {
        let _ = fs::remove_file(&archive_path);
        return Err("Downloaded Java runtime failed SHA-256 verification.".to_string());
    }

    let extraction = extract_java_archive(&archive_path, &staging_directory);
    let _ = fs::remove_file(&archive_path);
    extraction?;
    if current_directory.exists() {
        fs::remove_dir_all(&current_directory)
            .map_err(|error| format!("Unable to replace managed Java runtime: {error}"))?;
    }
    fs::rename(&staging_directory, &current_directory)
        .map_err(|error| format!("Unable to activate managed Java runtime: {error}"))?;

    let java_path = find_java_executable(&current_directory)
        .ok_or_else(|| "The downloaded Java runtime has no Java executable.".to_string())?;
    compatible_java_runtime(&java_path, required_major, "Ruin managed runtime")
        .ok_or_else(|| "The downloaded Java runtime has an incompatible version.".to_string())
}

#[tauri::command]
fn search_modrinth_mods(
    query: String,
    game_version: String,
    loader: String,
) -> Result<Vec<ModrinthProject>, String> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    if loader == "Vanilla" {
        return Err("Select a Fabric or Forge profile to browse mods.".to_string());
    }

    let facets = serde_json::json!([
        ["project_type:mod"],
        [format!("versions:{game_version}")],
        [format!("categories:{}", loader.to_lowercase())]
    ])
    .to_string();
    let parameters = [
        ("query", query.to_string()),
        ("limit", "20".to_string()),
        ("facets", facets),
    ];
    let results = http_client()?
        .get("https://api.modrinth.com/v2/search")
        .query(&parameters)
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .map_err(|error| format!("Modrinth search failed: {error}"))?
        .json::<ModrinthSearchResponse>()
        .map_err(|error| format!("Invalid Modrinth response: {error}"))?;

    Ok(results.hits)
}

#[tauri::command]
fn install_modrinth_mod(
    project_id: String,
    game_version: String,
    loader: String,
    game_directory: String,
) -> Result<LocalModFile, String> {
    if loader == "Vanilla" {
        return Err("Mods require a Fabric or Forge profile.".to_string());
    }
    if !project_id
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("Invalid Modrinth project identifier.".to_string());
    }
    if game_directory.trim().is_empty() {
        return Err("Choose a Minecraft game directory before installing mods.".to_string());
    }

    let loaders = serde_json::json!([loader.to_lowercase()]).to_string();
    let game_versions = serde_json::json!([game_version]).to_string();
    let parameters = [("loaders", loaders), ("game_versions", game_versions)];
    let versions_url = format!("https://api.modrinth.com/v2/project/{project_id}/version");
    let versions = http_client()?
        .get(versions_url)
        .query(&parameters)
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .map_err(|error| format!("Unable to resolve a compatible mod version: {error}"))?
        .json::<Vec<ModrinthVersion>>()
        .map_err(|error| format!("Invalid Modrinth version response: {error}"))?;
    let version = versions
        .first()
        .ok_or_else(|| "No compatible Modrinth version was found.".to_string())?;
    let file = version
        .files
        .iter()
        .find(|file| file.primary)
        .or_else(|| version.files.first())
        .ok_or_else(|| "The selected Modrinth version has no downloadable file.".to_string())?;
    let safe_filename = Path::new(&file.filename)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| *name == file.filename.as_str() && name.to_lowercase().ends_with(".jar"))
        .ok_or_else(|| "Modrinth returned an invalid mod filename.".to_string())?;
    let expected_checksum = file
        .hashes
        .get("sha512")
        .ok_or_else(|| "Modrinth did not provide a SHA-512 checksum.".to_string())?;

    let mods_directory = PathBuf::from(game_directory).join("mods");
    fs::create_dir_all(&mods_directory)
        .map_err(|error| format!("Unable to create mods directory: {error}"))?;
    let destination = mods_directory.join(safe_filename);
    let temporary = mods_directory.join(format!("{safe_filename}.part"));
    let mut response = http_client()?
        .get(&file.url)
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .map_err(|error| format!("Mod download failed: {error}"))?;
    let mut output = File::create(&temporary)
        .map_err(|error| format!("Unable to create mod download: {error}"))?;
    let mut hasher = Sha512::new();
    let mut buffer = [0_u8; 64 * 1024];
    let mut downloaded = 0_u64;
    loop {
        let count = response
            .read(&mut buffer)
            .map_err(|error| format!("Unable to read mod download: {error}"))?;
        if count == 0 {
            break;
        }
        downloaded = downloaded.saturating_add(count as u64);
        if downloaded > file.size {
            drop(output);
            let _ = fs::remove_file(&temporary);
            return Err("Mod download exceeded its declared size.".to_string());
        }
        output
            .write_all(&buffer[..count])
            .map_err(|error| format!("Unable to save mod download: {error}"))?;
        hasher.update(&buffer[..count]);
    }
    if downloaded != file.size {
        drop(output);
        let _ = fs::remove_file(&temporary);
        return Err("Mod download was incomplete.".to_string());
    }
    output
        .flush()
        .map_err(|error| format!("Unable to finish mod download: {error}"))?;
    drop(output);
    let checksum = format!("{:x}", hasher.finalize());
    if !checksum.eq_ignore_ascii_case(expected_checksum) {
        let _ = fs::remove_file(&temporary);
        return Err("Downloaded mod failed SHA-512 verification.".to_string());
    }
    if destination.exists() {
        fs::remove_file(&destination)
            .map_err(|error| format!("Unable to replace installed mod: {error}"))?;
    }
    fs::rename(&temporary, &destination)
        .map_err(|error| format!("Unable to install mod: {error}"))?;

    Ok(LocalModFile {
        name: safe_filename.to_string(),
        path: destination.to_string_lossy().into_owned(),
        size_kb: file.size.div_ceil(1024),
    })
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
        "none"
    } else {
        profile.loader.as_str()
    };
    let arguments = settings.launch_arguments.trim();
    let command_preview = format!(
        "java={} maximumMemoryMb={} customJvmArguments={} version={} loader={} profile={}",
        serde_json::to_string(&settings.java_path).unwrap_or_else(|_| "\"\"".to_string()),
        settings.memory_mb,
        serde_json::to_string(arguments).unwrap_or_else(|_| "\"\"".to_string()),
        serde_json::to_string(&profile.version).unwrap_or_else(|_| "\"\"".to_string()),
        serde_json::to_string(loader).unwrap_or_else(|_| "\"\"".to_string()),
        serde_json::to_string(&profile.name).unwrap_or_else(|_| "\"\"".to_string())
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
            fetch_minecraft_versions,
            ensure_java_runtime,
            search_modrinth_mods,
            install_modrinth_mod,
            scan_local_mods,
            run_preflight
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ruin Client");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selects_java_for_minecraft_generation() {
        assert_eq!(required_java_major("1.16.5"), 8);
        assert_eq!(required_java_major("1.17.1"), 16);
        assert_eq!(required_java_major("1.20.4"), 17);
        assert_eq!(required_java_major("1.20.5"), 21);
        assert_eq!(required_java_major("26.2"), 21);
    }

    #[test]
    fn parses_modrinth_api_field_names() {
        let response = serde_json::from_str::<ModrinthSearchResponse>(
            r#"{"hits":[{"project_id":"AANobbMI","title":"Sodium","description":"Fast","icon_url":null,"downloads":42}]}"#,
        )
        .expect("valid Modrinth response");

        assert_eq!(response.hits[0].project_id, "AANobbMI");
    }
}
