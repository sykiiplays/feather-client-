import { invoke } from '@tauri-apps/api/core'
import type {
  LauncherProfile,
  LauncherSettings,
  LauncherState,
  JavaRuntime,
  LocalModFile,
  MinecraftVersion,
  ModrinthProject,
  PlatformEnvironment,
  PreflightReport,
} from '../types'

const STORAGE_KEY = 'ruin-client-state-v1'

function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window
}

export async function loadState(): Promise<LauncherState | null> {
  if (isTauri()) {
    return invoke<LauncherState | null>('load_state')
  }

  const stored = localStorage.getItem(STORAGE_KEY)
  return stored ? (JSON.parse(stored) as LauncherState) : null
}

export async function saveState(state: LauncherState): Promise<void> {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  if (isTauri()) {
    await invoke('save_state', { state })
  }
}

export async function getEnvironment(): Promise<PlatformEnvironment> {
  if (isTauri()) {
    return invoke<PlatformEnvironment>('get_environment')
  }

  return {
    platform: navigator.platform || 'Web preview',
    defaultGameDirectory: '',
    totalMemoryMb: 8192,
    javaRuntimes: [],
  }
}

export async function scanLocalMods(
  gameDirectory: string,
): Promise<LocalModFile[]> {
  if (isTauri()) {
    return invoke<LocalModFile[]>('scan_local_mods', { gameDirectory })
  }
  return []
}

export async function fetchMinecraftVersions(): Promise<MinecraftVersion[]> {
  if (isTauri()) {
    return invoke<MinecraftVersion[]>('fetch_minecraft_versions')
  }

  const response = await fetch(
    'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
  )
  if (!response.ok) throw new Error('Unable to load Minecraft versions')
  const manifest = (await response.json()) as {
    versions: Array<{
      id: string
      type: MinecraftVersion['versionType']
      releaseTime: string
    }>
  }
  return manifest.versions.map((version) => ({
    id: version.id,
    versionType: version.type,
    releaseTime: version.releaseTime,
  }))
}

export async function ensureJavaRuntime(
  minecraftVersion: string,
  configuredJavaPath: string,
): Promise<JavaRuntime> {
  if (isTauri()) {
    return invoke<JavaRuntime>('ensure_java_runtime', {
      minecraftVersion,
      configuredJavaPath,
    })
  }
  if (!configuredJavaPath) {
    throw new Error('Automatic Java setup is available in the desktop app')
  }
  return {
    path: configuredJavaPath,
    version: 'Browser preview',
    source: 'Configured runtime',
  }
}

export async function searchModrinthMods(
  query: string,
  gameVersion: string,
  loader: string,
): Promise<ModrinthProject[]> {
  if (isTauri()) {
    return invoke<ModrinthProject[]>('search_modrinth_mods', {
      query,
      gameVersion,
      loader,
    })
  }

  const facets = JSON.stringify([
    ['project_type:mod'],
    [`versions:${gameVersion}`],
    [`categories:${loader.toLowerCase()}`],
  ])
  const parameters = new URLSearchParams({ query, limit: '20', facets })
  const response = await fetch(
    `https://api.modrinth.com/v2/search?${parameters.toString()}`,
  )
  if (!response.ok) throw new Error('Modrinth search failed')
  const results = (await response.json()) as {
    hits: Array<{
      project_id: string
      title: string
      description: string
      icon_url: string | null
      downloads: number
    }>
  }
  return results.hits.map((project) => ({
    projectId: project.project_id,
    title: project.title,
    description: project.description,
    iconUrl: project.icon_url,
    downloads: project.downloads,
  }))
}

export async function installModrinthMod(
  projectId: string,
  gameVersion: string,
  loader: string,
  gameDirectory: string,
): Promise<LocalModFile> {
  if (isTauri()) {
    return invoke<LocalModFile>('install_modrinth_mod', {
      projectId,
      gameVersion,
      loader,
      gameDirectory,
    })
  }
  throw new Error('Mod installation is available in the desktop app')
}

export async function runPreflight(
  profile: LauncherProfile,
  settings: LauncherSettings,
  accountConnected: boolean,
): Promise<PreflightReport> {
  if (isTauri()) {
    return invoke<PreflightReport>('run_preflight', {
      profile,
      settings,
      accountConnected,
    })
  }

  const checks = [
    {
      label: 'Microsoft account',
      passed: accountConnected,
      detail: accountConnected
        ? 'Account session is available.'
        : 'Connect a licensed Microsoft account.',
    },
    {
      label: 'Java runtime',
      passed: Boolean(settings.javaPath),
      detail: settings.javaPath || 'Choose or detect a Java runtime.',
    },
    {
      label: 'Game directory',
      passed: Boolean(settings.gameDirectory),
      detail: settings.gameDirectory || 'Set the Minecraft game directory.',
    },
    {
      label: 'Memory allocation',
      passed: settings.memoryMb >= 2048,
      detail: `${settings.memoryMb} MB allocated.`,
    },
  ]

  return {
    ready: checks.every((check) => check.passed),
    commandPreview: JSON.stringify({
      java: settings.javaPath || 'java',
      maximumMemoryMb: profile.memoryMb,
      customJvmArguments: settings.launchArguments,
      version: profile.version,
      loader: profile.loader,
      profile: profile.name,
    }),
    checks,
  }
}
