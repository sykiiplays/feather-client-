# Feather Client launcher MVP

A lightweight, local-first desktop launcher foundation for Minecraft Java Edition. The app uses React for the interface and Tauri/Rust for native system integration.

> This is an unofficial engineering MVP and is not affiliated with Mojang, Microsoft, Feather Client, or Dawn Client. It requires a licensed Minecraft account. It does not include Minecraft assets, proprietary client code, cracked authentication, or account bypasses.

## Included

- Cross-platform Tauri desktop shell for Windows, macOS, and Linux
- Fabric, Forge, and vanilla launch profiles
- Persistent profile, mod, account, and launcher settings
- Java runtime and system-memory detection
- Native `.jar` scanning from the selected `mods` folder
- Built-in module toggles for the future in-game client layer
- Dark and light themes with a responsive desktop UI
- Launch preflight for account, Java, game directory, RAM, and resolution
- Microsoft OAuth 2.0 Authorization Code + PKCE integration boundary
- Strict production content security policy and local-only state storage

## MVP boundary

The current launch button runs a real native preflight and produces the launch-engine handoff. It does **not** yet download Mojang manifests, install Fabric/Forge, complete Microsoft/Xbox/Minecraft token exchange, or start the Minecraft JVM. Those production services are intentionally separate because they require:

1. An Azure application registration and approved redirect URI
2. Secure refresh-token storage through each operating system keychain
3. Mojang version-manifest, asset, library, and native installers
4. Fabric/Forge metadata adapters with checksum verification
5. Minecraft ownership and profile verification

## Requirements

- Node.js 20.18 or newer
- Rust 1.88.0 (automatically selected by `rust-toolchain.toml`)
- Tauri system dependencies

Ubuntu/Debian:

```bash
sudo apt-get update
sudo apt-get install -y \
  pkg-config libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for Windows and macOS.

## Run

```bash
npm install
npm run desktop:dev
```

Browser-only UI preview:

```bash
npm run dev
```

## Validate and build

```bash
npm run lint
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml
npm run desktop:build
```

## Architecture

```text
src/
  App.tsx          launcher screens and interactions
  data.ts          safe starter profiles and built-in module catalog
  lib/native.ts    typed browser/Tauri integration boundary
  types.ts         shared frontend domain models
src-tauri/
  src/lib.rs       persistence, Java detection, mod scanning, preflight
  tauri.conf.json  desktop window, bundle, and CSP configuration
```

Launcher state is saved to the Tauri application-data directory as `launcher-state.json`. The browser preview falls back to `localStorage`.

## Production roadmap

- Microsoft, Xbox Live, XSTS, and Minecraft Services OAuth chain
- OS-keychain token storage and account switching
- Mojang manifest installer with SHA-1 verification
- Fabric and Forge installer adapters
- Real launch command construction and process telemetry
- Profile-specific directories, mod importing, and update checks
- Signed platform installers and auto-updates
- Separate Fabric client module implementing HUD features in-game

## Security rules

- Never collect a Microsoft password inside the launcher.
- Never log access or refresh tokens.
- Verify every downloaded game file against Mojang or loader metadata.
- Keep launcher commands argument-based; do not invoke a shell with user input.
- Do not redistribute Minecraft files or bypass ownership checks.
