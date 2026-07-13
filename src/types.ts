export type Page = 'home' | 'profiles' | 'mods' | 'settings'
export type Loader = 'Vanilla' | 'Fabric' | 'Forge'
export type Theme = 'dark' | 'light' | 'system'

export interface LauncherProfile {
  id: string
  name: string
  version: string
  loader: Loader
  loaderVersion: string
  memoryMb: number
  icon: string
  color: string
  lastPlayed: string
}

export interface ClientMod {
  id: string
  name: string
  description: string
  category: 'Performance' | 'HUD' | 'Utility' | 'Social'
  version: string
  enabled: boolean
  builtIn: boolean
}

export interface LauncherSettings {
  gameDirectory: string
  javaPath: string
  memoryMb: number
  resolutionWidth: number
  resolutionHeight: number
  closeOnLaunch: boolean
  autoConnectVoice: boolean
  showSnapshots: boolean
  launchArguments: string
  theme: Theme
}

export interface AccountState {
  connected: boolean
  username: string
  uuid: string
  avatarSeed: string
}

export interface LauncherState {
  activeProfileId: string
  profiles: LauncherProfile[]
  mods: ClientMod[]
  settings: LauncherSettings
  account: AccountState
  playMinutes: number
  launches: number
}

export interface JavaRuntime {
  path: string
  version: string
  source: string
}

export interface LocalModFile {
  name: string
  path: string
  sizeKb: number
}

export interface PlatformEnvironment {
  platform: string
  defaultGameDirectory: string
  totalMemoryMb: number
  javaRuntimes: JavaRuntime[]
}

export interface PreflightCheck {
  label: string
  passed: boolean
  detail: string
}

export interface PreflightReport {
  ready: boolean
  commandPreview: string
  checks: PreflightCheck[]
}
