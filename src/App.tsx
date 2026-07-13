import {
  Activity,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Cloud,
  Cog,
  Cpu,
  Download,
  FolderOpen,
  Gamepad2,
  Gauge,
  HardDrive,
  Home,
  Layers3,
  MemoryStick,
  Monitor,
  Moon,
  PackagePlus,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  UserRound,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { initialState, releaseNotes } from './data'
import {
  ensureJavaRuntime,
  fetchMinecraftVersions,
  getEnvironment,
  installModrinthMod,
  loadState,
  runPreflight,
  saveState,
  scanLocalMods,
  searchModrinthMods,
} from './lib/native'
import type {
  LauncherProfile,
  LauncherSettings,
  LauncherState,
  Loader,
  MinecraftVersion,
  ModrinthProject,
  Page,
  PlatformEnvironment,
  PreflightReport,
} from './types'

const navItems: { id: Page; label: string; icon: LucideIcon }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'profiles', label: 'Profiles', icon: Layers3 },
  { id: 'mods', label: 'Mods', icon: Boxes },
  { id: 'settings', label: 'Settings', icon: Cog },
]

const emptyEnvironment: PlatformEnvironment = {
  platform: 'Detecting…',
  defaultGameDirectory: '',
  totalMemoryMb: 0,
  javaRuntimes: [],
}

function mergeState(stored: LauncherState | null): LauncherState {
  const defaults: LauncherState = {
    ...initialState,
    profiles: initialState.profiles.map((profile) => ({ ...profile })),
    mods: initialState.mods.map((mod) => ({ ...mod })),
    settings: { ...initialState.settings },
    account: { ...initialState.account },
  }

  if (!stored) return defaults

  return {
    ...defaults,
    ...stored,
    profiles: stored.profiles.map((profile) => ({ ...profile })),
    mods: stored.mods.map((mod) => ({ ...mod })),
    settings: { ...defaults.settings, ...stored.settings },
    account: { ...defaults.account, ...stored.account },
  }
}

function formatPlaytime(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function App() {
  const [activePage, setActivePage] = useState<Page>('home')
  const [launcherState, setLauncherState] = useState<LauncherState>(() =>
    mergeState(null),
  )
  const [environment, setEnvironment] =
    useState<PlatformEnvironment>(emptyEnvironment)
  const [ready, setReady] = useState(false)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [accountModalOpen, setAccountModalOpen] = useState(false)
  const [profileModalOpen, setProfileModalOpen] = useState(false)
  const [modrinthModalOpen, setModrinthModalOpen] = useState(false)
  const [preflight, setPreflight] = useState<PreflightReport | null>(null)
  const [launching, setLaunching] = useState(false)
  const [minecraftVersions, setMinecraftVersions] = useState<
    MinecraftVersion[]
  >([])
  const [modSearch, setModSearch] = useState('')
  const [modFilter, setModFilter] = useState('All')
  const [modrinthQuery, setModrinthQuery] = useState('performance')
  const [modrinthResults, setModrinthResults] = useState<ModrinthProject[]>([])
  const [modrinthLoading, setModrinthLoading] = useState(false)
  const [installingMod, setInstallingMod] = useState('')
  const [toast, setToast] = useState('')
  const [profileDraft, setProfileDraft] = useState({
    name: 'New profile',
    version: '1.21.5',
    loader: 'Fabric' as Loader,
  })
  const toastTimer = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false

    async function hydrate() {
      const [stored, platform, versions] = await Promise.all([
        loadState().catch(() => null),
        getEnvironment().catch(() => emptyEnvironment),
        fetchMinecraftVersions().catch(() => []),
      ])

      if (cancelled) return

      const merged = mergeState(stored)
      if (!merged.settings.gameDirectory && platform.defaultGameDirectory) {
        merged.settings.gameDirectory = platform.defaultGameDirectory
      }
      if (!merged.settings.javaPath && platform.javaRuntimes[0]) {
        merged.settings.javaPath = platform.javaRuntimes[0].path
      }

      setLauncherState(merged)
      setEnvironment(platform)
      setMinecraftVersions(versions)
      setReady(true)
    }

    void hydrate()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    void saveState(launcherState)
  }, [launcherState, ready])

  useEffect(() => {
    document.documentElement.dataset.theme = launcherState.settings.theme
  }, [launcherState.settings.theme])

  const activeProfile =
    launcherState.profiles.find(
      (profile) => profile.id === launcherState.activeProfileId,
    ) ?? launcherState.profiles[0]

  const filteredMods = useMemo(() => {
    const query = modSearch.trim().toLowerCase()
    return launcherState.mods.filter((mod) => {
      const matchesSearch =
        !query ||
        mod.name.toLowerCase().includes(query) ||
        mod.description.toLowerCase().includes(query)
      const matchesFilter = modFilter === 'All' || mod.category === modFilter
      return matchesSearch && matchesFilter
    })
  }, [launcherState.mods, modFilter, modSearch])

  function notify(message: string) {
    setToast(message)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 2800)
  }

  function patchState(patch: Partial<LauncherState>) {
    setLauncherState((current) => ({ ...current, ...patch }))
  }

  function updateSettings<K extends keyof LauncherSettings>(
    key: K,
    value: LauncherSettings[K],
  ) {
    setLauncherState((current) => ({
      ...current,
      settings: { ...current.settings, [key]: value },
    }))
  }

  function toggleMod(id: string) {
    setLauncherState((current) => ({
      ...current,
      mods: current.mods.map((mod) =>
        mod.id === id ? { ...mod, enabled: !mod.enabled } : mod,
      ),
    }))
  }

  function selectProfile(id: string) {
    const profile = launcherState.profiles.find((item) => item.id === id)
    if (!profile) return

    setLauncherState((current) => ({
      ...current,
      activeProfileId: id,
      settings: { ...current.settings, memoryMb: profile.memoryMb },
    }))
    setProfileMenuOpen(false)
  }

  async function handleLaunch() {
    if (!activeProfile) return
    setLaunching(true)
    try {
      const runtime = await ensureJavaRuntime(
        activeProfile.version,
        launcherState.settings.javaPath,
      )
      const settings = {
        ...launcherState.settings,
        javaPath: runtime.path,
      }
      updateSettings('javaPath', runtime.path)
      const report = await runPreflight(
        activeProfile,
        settings,
        launcherState.account.connected,
      )
      setPreflight(report)
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error))
    } finally {
      setLaunching(false)
    }
  }

  function createProfile() {
    const id = `${profileDraft.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`
    const profile: LauncherProfile = {
      id,
      name: profileDraft.name.trim() || 'New profile',
      version: profileDraft.version.trim() || '1.21.5',
      loader: profileDraft.loader,
      loaderVersion:
        profileDraft.loader === 'Vanilla' ? '' : 'Auto',
      memoryMb: launcherState.settings.memoryMb,
      icon: profileDraft.name.trim().slice(0, 2).toUpperCase() || 'NP',
      color: '#f97316',
      lastPlayed: 'Never',
    }

    setLauncherState((current) => ({
      ...current,
      activeProfileId: profile.id,
      profiles: [...current.profiles, profile],
    }))
    setProfileModalOpen(false)
    setProfileDraft({
      name: 'New profile',
      version: '1.21.5',
      loader: 'Fabric',
    })
    notify('Profile created')
  }

  function deleteProfile(id: string) {
    if (launcherState.profiles.length === 1) {
      notify('Keep at least one profile')
      return
    }

    setLauncherState((current) => {
      const profiles = current.profiles.filter((profile) => profile.id !== id)
      return {
        ...current,
        profiles,
        activeProfileId:
          current.activeProfileId === id
            ? profiles[0].id
            : current.activeProfileId,
      }
    })
    notify('Profile removed')
  }

  function detectJava() {
    const runtime = environment.javaRuntimes[0]
    if (!runtime) {
      notify('No Java runtime detected')
      return
    }
    updateSettings('javaPath', runtime.path)
    notify(`Using Java ${runtime.version}`)
  }

  async function scanMods() {
    try {
      const files = await scanLocalMods(launcherState.settings.gameDirectory)
      if (files.length === 0) {
        notify('No .jar mods found in the mods folder')
        return
      }

      setLauncherState((current) => ({
        ...current,
        mods: [
          ...current.mods.filter((mod) => mod.builtIn),
          ...files.map((file) => ({
            id: `local-${file.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
            name: file.name.replace(/\.jar$/i, ''),
            description: `${file.sizeKb} KB · ${file.path}`,
            category: 'Utility' as const,
            version: 'local',
            enabled: true,
            builtIn: false,
          })),
        ],
      }))
      notify(`${files.length} local mod${files.length === 1 ? '' : 's'} found`)
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error))
    }
  }

  async function searchModrinth() {
    if (!activeProfile) return
    setModrinthLoading(true)
    try {
      const results = await searchModrinthMods(
        modrinthQuery,
        activeProfile.version,
        activeProfile.loader,
      )
      setModrinthResults(results)
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error))
    } finally {
      setModrinthLoading(false)
    }
  }

  async function installFromModrinth(project: ModrinthProject) {
    if (!activeProfile) return
    setInstallingMod(project.projectId)
    try {
      const file = await installModrinthMod(
        project.projectId,
        activeProfile.version,
        activeProfile.loader,
        launcherState.settings.gameDirectory,
      )
      setLauncherState((current) => ({
        ...current,
        mods: [
          ...current.mods.filter(
            (mod) => mod.id !== `modrinth-${project.projectId}`,
          ),
          {
            id: `modrinth-${project.projectId}`,
            name: project.title,
            description: `${file.sizeKb} KB · ${file.path}`,
            category: 'Utility',
            version: activeProfile.version,
            enabled: true,
            builtIn: false,
          },
        ],
      }))
      notify(`${project.title} installed from Modrinth`)
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error))
    } finally {
      setInstallingMod('')
    }
  }

  if (!activeProfile) return null

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setActivePage('home')}>
          <span className="brand-mark">
            <Zap size={22} strokeWidth={2.4} />
          </span>
          <span>
            <strong>Ruin</strong>
            <small>CLIENT</small>
          </span>
        </button>

        <nav className="main-nav" aria-label="Main navigation">
          <p className="nav-label">LAUNCHER</p>
          {navItems.map(({ id, label, icon: Icon }) => (
            <button
              className={`nav-item ${activePage === id ? 'active' : ''}`}
              key={id}
              onClick={() => setActivePage(id)}
            >
              <Icon size={19} />
              <span>{label}</span>
              {id === 'mods' && (
                <span className="nav-badge">
                  {launcherState.mods.filter((mod) => mod.enabled).length}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-promo">
          <span className="promo-icon">
            <Cloud size={18} />
          </span>
          <p>Host your world</p>
          <small>Server hosting integration</small>
          <button onClick={() => notify('Server hosting is on the roadmap')}>
            Explore <ChevronRight size={14} />
          </button>
        </div>

        <div className="sidebar-footer">
          <button onClick={() => notify('You are running the latest MVP')}>
            <CircleHelp size={17} />
            Support
          </button>
          <span>v0.1.0 MVP</span>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">
              {activePage === 'home' ? 'GOOD TO SEE YOU' : 'RUIN CLIENT'}
            </p>
            <h1>
              {activePage === 'home'
                ? launcherState.account.connected
                  ? `Welcome back, ${launcherState.account.username}`
                  : 'Ready when you are'
                : navItems.find((item) => item.id === activePage)?.label}
            </h1>
          </div>
          <div className="topbar-actions">
            <button
              className="icon-button theme-toggle"
              aria-label="Toggle theme"
              onClick={() =>
                updateSettings(
                  'theme',
                  launcherState.settings.theme === 'light' ? 'dark' : 'light',
                )
              }
            >
              {launcherState.settings.theme === 'light' ? (
                <Moon size={18} />
              ) : (
                <Sun size={18} />
              )}
            </button>
            <button
              className="account-button"
              onClick={() => setAccountModalOpen(true)}
            >
              <span className="account-avatar">
                <UserRound size={17} />
              </span>
              <span>
                <strong>
                  {launcherState.account.connected
                    ? launcherState.account.username
                    : 'Add account'}
                </strong>
                <small>
                  {launcherState.account.connected
                    ? 'Microsoft'
                    : 'Not connected'}
                </small>
              </span>
              <ChevronDown size={15} />
            </button>
          </div>
        </header>

        <div className="page-scroll">
          {activePage === 'home' && (
            <HomePage
              activeProfile={activeProfile}
              launcherState={launcherState}
              launching={launching}
              profileMenuOpen={profileMenuOpen}
              setProfileMenuOpen={setProfileMenuOpen}
              selectProfile={selectProfile}
              handleLaunch={handleLaunch}
              setActivePage={setActivePage}
            />
          )}

          {activePage === 'profiles' && (
            <ProfilesPage
              profiles={launcherState.profiles}
              activeProfileId={launcherState.activeProfileId}
              selectProfile={selectProfile}
              deleteProfile={deleteProfile}
              openNewProfile={() => setProfileModalOpen(true)}
            />
          )}

          {activePage === 'mods' && (
            <ModsPage
              mods={filteredMods}
              totalMods={launcherState.mods.length}
              search={modSearch}
              filter={modFilter}
              setSearch={setModSearch}
              setFilter={setModFilter}
              toggleMod={toggleMod}
              scanMods={scanMods}
              browseModrinth={() => setModrinthModalOpen(true)}
            />
          )}

          {activePage === 'settings' && (
            <SettingsPage
              settings={launcherState.settings}
              environment={environment}
              updateSettings={updateSettings}
              detectJava={detectJava}
            />
          )}
        </div>
      </main>

      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}

      {accountModalOpen && (
        <Modal
          title="Microsoft account"
          subtitle="Secure authentication integration"
          close={() => setAccountModalOpen(false)}
        >
          <div className="account-connect">
            <span className="modal-hero-icon">
              <ShieldCheck size={28} />
            </span>
            <h3>Sign in with Microsoft</h3>
            <p>
              Production login uses OAuth 2.0 Authorization Code + PKCE. No
              passwords are collected or stored by the launcher.
            </p>
            <div className="integration-note">
              <Settings2 size={18} />
              <span>
                Add an Azure application client ID and approved redirect URI to
                activate this integration.
              </span>
            </div>
            <button className="primary wide" disabled>
              <UserRound size={17} />
              Connect Microsoft account
            </button>
            <a
              href="https://learn.microsoft.com/entra/identity-platform/v2-oauth2-auth-code-flow"
              target="_blank"
              rel="noreferrer"
            >
              View Microsoft OAuth documentation
              <ChevronRight size={14} />
            </a>
          </div>
        </Modal>
      )}

      {profileModalOpen && (
        <Modal
          title="Create profile"
          subtitle="Keep every setup isolated"
          close={() => setProfileModalOpen(false)}
        >
          <div className="profile-form">
            <label>
              Profile name
              <input
                value={profileDraft.name}
                onChange={(event) =>
                  setProfileDraft((draft) => ({
                    ...draft,
                    name: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Minecraft version
              <input
                list="minecraft-version-catalog"
                value={profileDraft.version}
                onChange={(event) =>
                  setProfileDraft((draft) => ({
                    ...draft,
                    version: event.target.value,
                  }))
                }
              />
              <datalist id="minecraft-version-catalog">
                {minecraftVersions
                  .filter(
                    (version) =>
                      launcherState.settings.showSnapshots ||
                      version.versionType !== 'snapshot',
                  )
                  .map((version) => (
                    <option key={version.id} value={version.id}>
                      {version.versionType.replace('_', ' ')}
                    </option>
                  ))}
              </datalist>
              <small>
                {minecraftVersions.length > 0
                  ? `${minecraftVersions.length} official Mojang versions loaded`
                  : 'Enter a Minecraft version'}
              </small>
            </label>
            <label>
              Mod loader
              <select
                value={profileDraft.loader}
                onChange={(event) =>
                  setProfileDraft((draft) => ({
                    ...draft,
                    loader: event.target.value as Loader,
                  }))
                }
              >
                <option>Fabric</option>
                <option>Forge</option>
                <option>Vanilla</option>
              </select>
            </label>
            <button className="primary wide" onClick={createProfile}>
              <Plus size={17} />
              Create profile
            </button>
          </div>
        </Modal>
      )}

      {modrinthModalOpen && (
        <Modal
          title="Browse Modrinth"
          subtitle={`${activeProfile.version} · ${activeProfile.loader}`}
          close={() => setModrinthModalOpen(false)}
        >
          <div className="modrinth-browser">
            <form
              className="modrinth-search"
              onSubmit={(event) => {
                event.preventDefault()
                void searchModrinth()
              }}
            >
              <label className="search-box">
                <Search size={17} />
                <input
                  autoFocus
                  value={modrinthQuery}
                  placeholder="Search compatible mods"
                  onChange={(event) => setModrinthQuery(event.target.value)}
                />
              </label>
              <button
                className="primary"
                type="submit"
                disabled={modrinthLoading}
              >
                <Search size={16} />
                {modrinthLoading ? 'Searching…' : 'Search'}
              </button>
            </form>
            <div className="modrinth-results">
              {modrinthResults.map((project) => (
                <article className="modrinth-result" key={project.projectId}>
                  {project.iconUrl ? (
                    <img src={project.iconUrl} alt="" />
                  ) : (
                    <span className="modrinth-placeholder">
                      <PackagePlus size={20} />
                    </span>
                  )}
                  <div>
                    <strong>{project.title}</strong>
                    <p>{project.description}</p>
                    <small>
                      {Intl.NumberFormat('en', {
                        notation: 'compact',
                      }).format(project.downloads)}{' '}
                      downloads
                    </small>
                  </div>
                  <button
                    className="secondary"
                    disabled={Boolean(installingMod)}
                    onClick={() => void installFromModrinth(project)}
                  >
                    <Download size={15} />
                    {installingMod === project.projectId
                      ? 'Installing…'
                      : 'Install'}
                  </button>
                </article>
              ))}
              {!modrinthLoading && modrinthResults.length === 0 && (
                <div className="empty-state compact">
                  <PackagePlus size={26} />
                  <h3>Find profile-compatible mods</h3>
                  <p>Search Modrinth and install verified files in one click.</p>
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}

      {preflight && (
        <Modal
          title={preflight.ready ? 'Ready to launch' : 'Launch preflight'}
          subtitle={activeProfile.name}
          close={() => setPreflight(null)}
        >
          <div className="preflight">
            <div
              className={`preflight-status ${
                preflight.ready ? 'success' : 'warning'
              }`}
            >
              {preflight.ready ? (
                <Check size={22} />
              ) : (
                <Activity size={22} />
              )}
              <div>
                <strong>
                  {preflight.ready
                    ? 'Runtime checks passed'
                    : 'A few things need attention'}
                </strong>
                <span>
                  {preflight.ready
                    ? 'The native launch-engine handoff is ready.'
                    : 'Complete the failed checks before starting Minecraft.'}
                </span>
              </div>
            </div>
            <div className="check-list">
              {preflight.checks.map((check) => (
                <div className="check-row" key={check.label}>
                  <span
                    className={`check-icon ${check.passed ? 'passed' : ''}`}
                  >
                    {check.passed ? <Check size={14} /> : <X size={14} />}
                  </span>
                  <div>
                    <strong>{check.label}</strong>
                    <small>{check.detail}</small>
                  </div>
                </div>
              ))}
            </div>
            <div className="command-preview">
              <span>LAUNCH PLAN</span>
              <code>{preflight.commandPreview}</code>
            </div>
            <button
              className="primary wide"
              disabled={!preflight.ready}
              onClick={() => {
                patchState({
                  launches: launcherState.launches + 1,
                })
                setPreflight(null)
                notify('Launch-engine adapter is ready for implementation')
              }}
            >
              <Play size={17} fill="currentColor" />
              Hand off to launch engine
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

interface HomePageProps {
  activeProfile: LauncherProfile
  launcherState: LauncherState
  launching: boolean
  profileMenuOpen: boolean
  setProfileMenuOpen: (open: boolean) => void
  selectProfile: (id: string) => void
  handleLaunch: () => Promise<void>
  setActivePage: (page: Page) => void
}

function HomePage({
  activeProfile,
  launcherState,
  launching,
  profileMenuOpen,
  setProfileMenuOpen,
  selectProfile,
  handleLaunch,
  setActivePage,
}: HomePageProps) {
  const enabledMods = launcherState.mods.filter((mod) => mod.enabled).length

  return (
    <section className="home-page">
      <div className="hero-card">
        <div className="hero-grid" />
        <div className="hero-glow one" />
        <div className="hero-glow two" />
        <div className="hero-blocks" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="hero-copy">
          <span className="hero-pill">
            <Zap size={13} fill="currentColor" />
            PERFORMANCE PROFILE
          </span>
          <h2>Play Minecraft, your way.</h2>
          <p>
            Lightweight profiles, clean mod control, and native performance
            settings without the clutter.
          </p>
        </div>
        <div className="launch-panel">
          <div className="profile-picker">
            <button
              className="profile-select"
              onClick={() => setProfileMenuOpen(!profileMenuOpen)}
            >
              <span
                className="profile-icon"
                style={{ background: activeProfile.color }}
              >
                {activeProfile.icon}
              </span>
              <span>
                <small>SELECTED PROFILE</small>
                <strong>{activeProfile.name}</strong>
                <em>
                  Minecraft {activeProfile.version} · {activeProfile.loader}
                </em>
              </span>
              <ChevronDown size={17} />
            </button>
            {profileMenuOpen && (
              <div className="profile-menu">
                {launcherState.profiles.map((profile) => (
                  <button
                    key={profile.id}
                    onClick={() => selectProfile(profile.id)}
                  >
                    <span
                      className="mini-profile-icon"
                      style={{ background: profile.color }}
                    >
                      {profile.icon}
                    </span>
                    <span>
                      <strong>{profile.name}</strong>
                      <small>
                        {profile.version} · {profile.loader}
                      </small>
                    </span>
                    {profile.id === activeProfile.id && <Check size={15} />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className="launch-button"
            onClick={() => void handleLaunch()}
            disabled={launching}
          >
            {launching ? (
              <RefreshCw className="spin" size={20} />
            ) : (
              <Play size={20} fill="currentColor" />
            )}
            <span>
              <strong>{launching ? 'PREPARING JAVA…' : 'LAUNCH GAME'}</strong>
              <small>{activeProfile.version}</small>
            </span>
          </button>
        </div>
      </div>

      <div className="stats-grid">
        <StatCard
          icon={Clock3}
          label="PLAYTIME"
          value={formatPlaytime(launcherState.playMinutes)}
          detail="Local launcher stats"
          color="violet"
        />
        <StatCard
          icon={Gauge}
          label="PROFILE MEMORY"
          value={`${activeProfile.memoryMb / 1024} GB`}
          detail="Optimized allocation"
          color="cyan"
        />
        <StatCard
          icon={Boxes}
          label="ACTIVE MODS"
          value={`${enabledMods}`}
          detail={`${launcherState.mods.length} available`}
          color="green"
        />
        <StatCard
          icon={Gamepad2}
          label="LAUNCHES"
          value={`${launcherState.launches}`}
          detail="On this device"
          color="orange"
        />
      </div>

      <div className="section-heading">
        <div>
          <span>WHAT’S NEW</span>
          <h3>Inside Ruin</h3>
        </div>
        <button onClick={() => setActivePage('mods')}>
          Explore mods <ChevronRight size={15} />
        </button>
      </div>
      <div className="news-grid">
        {releaseNotes.map((note) => (
          <article className={`news-card ${note.accent}`} key={note.title}>
            <div className="news-art">
              <span className="news-orbit" />
              {note.accent === 'violet' ? (
                <Cpu size={42} />
              ) : (
                <PackagePlus size={42} />
              )}
            </div>
            <div className="news-copy">
              <span>{note.tag}</span>
              <h4>{note.title}</h4>
              <p>{note.description}</p>
              <small>{note.date}</small>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

interface StatCardProps {
  icon: LucideIcon
  label: string
  value: string
  detail: string
  color: string
}

function StatCard({
  icon: Icon,
  label,
  value,
  detail,
  color,
}: StatCardProps) {
  return (
    <article className="stat-card">
      <span className={`stat-icon ${color}`}>
        <Icon size={19} />
      </span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  )
}

interface ProfilesPageProps {
  profiles: LauncherProfile[]
  activeProfileId: string
  selectProfile: (id: string) => void
  deleteProfile: (id: string) => void
  openNewProfile: () => void
}

function ProfilesPage({
  profiles,
  activeProfileId,
  selectProfile,
  deleteProfile,
  openNewProfile,
}: ProfilesPageProps) {
  return (
    <section className="content-page">
      <div className="page-heading">
        <div>
          <p>ISOLATED INSTANCES</p>
          <h2>Your profiles</h2>
          <span>
            Keep versions, mod loaders, memory, and game files organized.
          </span>
        </div>
        <button className="primary" onClick={openNewProfile}>
          <Plus size={17} />
          New profile
        </button>
      </div>
      <div className="profile-grid">
        {profiles.map((profile) => (
          <article
            className={`profile-card ${
              profile.id === activeProfileId ? 'selected' : ''
            }`}
            key={profile.id}
          >
            <div className="profile-card-top">
              <span
                className="large-profile-icon"
                style={{ background: profile.color }}
              >
                {profile.icon}
              </span>
              {profile.id === activeProfileId && (
                <span className="selected-pill">
                  <Check size={12} /> ACTIVE
                </span>
              )}
            </div>
            <h3>{profile.name}</h3>
            <p>
              Minecraft {profile.version} · {profile.loader}
              {profile.loaderVersion ? ` ${profile.loaderVersion}` : ''}
            </p>
            <div className="profile-meta">
              <span>
                <MemoryStick size={15} />
                {profile.memoryMb / 1024} GB RAM
              </span>
              <span>
                <Clock3 size={15} />
                {profile.lastPlayed}
              </span>
            </div>
            <div className="profile-card-actions">
              <button
                className="secondary"
                onClick={() => selectProfile(profile.id)}
              >
                {profile.id === activeProfileId ? 'Selected' : 'Use profile'}
              </button>
              <button
                className="icon-button danger"
                aria-label={`Delete ${profile.name}`}
                onClick={() => deleteProfile(profile.id)}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </article>
        ))}
        <button className="new-profile-card" onClick={openNewProfile}>
          <span>
            <Plus size={22} />
          </span>
          <strong>Create another profile</strong>
          <small>Fabric, Forge, or vanilla</small>
        </button>
      </div>
    </section>
  )
}

interface ModsPageProps {
  mods: LauncherState['mods']
  totalMods: number
  search: string
  filter: string
  setSearch: (value: string) => void
  setFilter: (value: string) => void
  toggleMod: (id: string) => void
  scanMods: () => Promise<void>
  browseModrinth: () => void
}

function ModsPage({
  mods,
  totalMods,
  search,
  filter,
  setSearch,
  setFilter,
  toggleMod,
  scanMods,
  browseModrinth,
}: ModsPageProps) {
  return (
    <section className="content-page">
      <div className="page-heading">
        <div>
          <p>MOD MANAGER</p>
          <h2>Make it yours</h2>
          <span>
            Toggle built-in modules and prepare profile-specific mod folders.
          </span>
        </div>
        <div className="heading-actions">
          <button className="secondary" onClick={() => void scanMods()}>
            <FolderOpen size={17} />
            Scan local mods
          </button>
          <button className="primary" onClick={browseModrinth}>
            <Download size={17} />
            Browse Modrinth
          </button>
        </div>
      </div>
      <div className="mods-toolbar">
        <label className="search-box">
          <Search size={17} />
          <input
            placeholder={`Search ${totalMods} modules`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div className="filter-tabs">
          {['All', 'Performance', 'HUD', 'Utility', 'Social'].map((item) => (
            <button
              className={filter === item ? 'active' : ''}
              key={item}
              onClick={() => setFilter(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <div className="mod-list">
        {mods.map((mod) => (
          <article className="mod-row" key={mod.id}>
            <span className={`mod-icon ${mod.category.toLowerCase()}`}>
              {mod.category === 'Performance' ? (
                <Zap size={20} />
              ) : mod.category === 'HUD' ? (
                <Monitor size={20} />
              ) : mod.category === 'Social' ? (
                <UserRound size={20} />
              ) : (
                <Sparkles size={20} />
              )}
            </span>
            <div className="mod-copy">
              <div>
                <h3>{mod.name}</h3>
                <span>{mod.builtIn ? 'BUILT-IN' : 'LOCAL'}</span>
              </div>
              <p>{mod.description}</p>
              <small>
                {mod.category} · v{mod.version}
              </small>
            </div>
            <button
              className={`switch ${mod.enabled ? 'on' : ''}`}
              role="switch"
              aria-checked={mod.enabled}
              aria-label={`Toggle ${mod.name}`}
              onClick={() => toggleMod(mod.id)}
            >
              <span />
            </button>
          </article>
        ))}
        {mods.length === 0 && (
          <div className="empty-state">
            <Search size={28} />
            <h3>No modules found</h3>
            <p>Try another search or filter.</p>
          </div>
        )}
      </div>
    </section>
  )
}

interface SettingsPageProps {
  settings: LauncherSettings
  environment: PlatformEnvironment
  updateSettings: <K extends keyof LauncherSettings>(
    key: K,
    value: LauncherSettings[K],
  ) => void
  detectJava: () => void
}

function SettingsPage({
  settings,
  environment,
  updateSettings,
  detectJava,
}: SettingsPageProps) {
  const maximumMemoryMb = Math.max(
    8192,
    Math.floor((environment.totalMemoryMb - 2048) / 1024) * 1024,
  )

  return (
    <section className="content-page settings-page">
      <div className="page-heading">
        <div>
          <p>LAUNCHER CONFIGURATION</p>
          <h2>Settings</h2>
          <span>
            Tune your runtime, display, folders, and launcher behavior.
          </span>
        </div>
      </div>

      <SettingsGroup
        icon={Cpu}
        title="Java & memory"
        description={`Detected platform: ${environment.platform}`}
      >
        <div className="setting-row stacked">
          <div>
            <strong>Java executable</strong>
            <span>Java 21 is recommended for current Minecraft versions.</span>
          </div>
          <div className="input-action">
            <input
              value={settings.javaPath}
              placeholder="/path/to/java"
              onChange={(event) =>
                updateSettings('javaPath', event.target.value)
              }
            />
            <button className="secondary" onClick={detectJava}>
              <RefreshCw size={15} />
              Detect
            </button>
          </div>
          {environment.javaRuntimes.length > 0 && (
            <small className="detected-value">
              <Check size={13} />
              {environment.javaRuntimes.length} runtime
              {environment.javaRuntimes.length === 1 ? '' : 's'} detected
            </small>
          )}
        </div>
        <div className="setting-row stacked">
          <div>
            <strong>Memory allocation</strong>
            <span>
              Keep enough memory available for your operating system.
            </span>
          </div>
          <div className="range-heading">
            <span>2 GB</span>
            <strong>{settings.memoryMb / 1024} GB</strong>
            <span>{maximumMemoryMb / 1024} GB</span>
          </div>
          <input
            className="range"
            type="range"
            min="2048"
            max={maximumMemoryMb}
            step="1024"
            value={settings.memoryMb}
            onChange={(event) =>
              updateSettings('memoryMb', Number(event.target.value))
            }
          />
        </div>
      </SettingsGroup>

      <SettingsGroup
        icon={HardDrive}
        title="Game files"
        description="Minecraft versions, assets, libraries, and profile mods"
      >
        <div className="setting-row stacked">
          <div>
            <strong>Game directory</strong>
            <span>Use an existing .minecraft folder or an isolated folder.</span>
          </div>
          <div className="input-action">
            <input
              value={settings.gameDirectory}
              placeholder="Minecraft game directory"
              onChange={(event) =>
                updateSettings('gameDirectory', event.target.value)
              }
            />
            <button
              className="secondary"
              type="button"
              disabled
              title="Paste a path or add the dialog plugin"
            >
              <FolderOpen size={15} />
              Browse
            </button>
          </div>
        </div>
        <div className="setting-row stacked">
          <div>
            <strong>JVM launch arguments</strong>
            <span>Advanced flags passed to the selected Java runtime.</span>
          </div>
          <textarea
            value={settings.launchArguments}
            onChange={(event) =>
              updateSettings('launchArguments', event.target.value)
            }
          />
        </div>
      </SettingsGroup>

      <SettingsGroup
        icon={Monitor}
        title="Window & behavior"
        description="Display size and launcher preferences"
      >
        <div className="setting-row">
          <div>
            <strong>Game resolution</strong>
            <span>Default window dimensions on launch.</span>
          </div>
          <div className="resolution-inputs">
            <input
              type="number"
              value={settings.resolutionWidth}
              onChange={(event) =>
                updateSettings('resolutionWidth', Number(event.target.value))
              }
            />
            <X size={13} />
            <input
              type="number"
              value={settings.resolutionHeight}
              onChange={(event) =>
                updateSettings('resolutionHeight', Number(event.target.value))
              }
            />
          </div>
        </div>
        <ToggleSetting
          title="Close launcher on game start"
          description="Keep it open by default for quick profile changes."
          checked={settings.closeOnLaunch}
          toggle={() =>
            updateSettings('closeOnLaunch', !settings.closeOnLaunch)
          }
        />
        <ToggleSetting
          title="Auto-connect voice"
          description="Allow the configured voice provider to connect on launch."
          checked={settings.autoConnectVoice}
          toggle={() =>
            updateSettings('autoConnectVoice', !settings.autoConnectVoice)
          }
        />
        <ToggleSetting
          title="Show snapshot versions"
          description="Include unstable Minecraft snapshots in version lists."
          checked={settings.showSnapshots}
          toggle={() =>
            updateSettings('showSnapshots', !settings.showSnapshots)
          }
        />
      </SettingsGroup>
    </section>
  )
}

interface SettingsGroupProps {
  icon: LucideIcon
  title: string
  description: string
  children: React.ReactNode
}

function SettingsGroup({
  icon: Icon,
  title,
  description,
  children,
}: SettingsGroupProps) {
  return (
    <section className="settings-group">
      <header>
        <span>
          <Icon size={19} />
        </span>
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </header>
      <div className="settings-body">{children}</div>
    </section>
  )
}

interface ToggleSettingProps {
  title: string
  description: string
  checked: boolean
  toggle: () => void
}

function ToggleSetting({
  title,
  description,
  checked,
  toggle,
}: ToggleSettingProps) {
  return (
    <div className="setting-row">
      <div>
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
      <button
        className={`switch ${checked ? 'on' : ''}`}
        role="switch"
        aria-checked={checked}
        onClick={toggle}
      >
        <span />
      </button>
    </div>
  )
}

interface ModalProps {
  title: string
  subtitle: string
  close: () => void
  children: React.ReactNode
}

function Modal({ title, subtitle, close, children }: ModalProps) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={close}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>{subtitle}</span>
            <h2>{title}</h2>
          </div>
          <button className="icon-button" aria-label="Close" onClick={close}>
            <X size={18} />
          </button>
        </header>
        {children}
      </section>
    </div>
  )
}

export default App
