import { invoke } from '@tauri-apps/api/core'
import type {
  LauncherProfile,
  LauncherSettings,
  LauncherState,
  LocalModFile,
  PlatformEnvironment,
  PreflightReport,
} from '../types'

const STORAGE_KEY = 'feather-client-state-v1'

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
    commandPreview: `${settings.javaPath || 'java'} -Xmx${profile.memoryMb}M …`,
    checks,
  }
}
