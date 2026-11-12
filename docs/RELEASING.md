# Releasing Postguy

Installers are built by GitHub Actions (`.github/workflows/release.yml`) for:

| Platform | Target | Installers |
| --- | --- | --- |
| macOS, Apple Silicon | `aarch64-apple-darwin` | `.dmg`, `.app` |
| macOS, Intel | `x86_64-apple-darwin` | `.dmg`, `.app` |
| Windows | `x86_64-pc-windows-msvc` | `.msi`, NSIS `.exe` |
| Linux | `x86_64-unknown-linux-gnu` | `.deb`, `.rpm`, `.AppImage` |

## Cutting a release

1. Bump `version` in `apps/desktop/src-tauri/tauri.conf.json` (and `Cargo.toml` if you track it there).
2. Commit, then tag and push: `git tag v0.2.0 && git push origin v0.2.0`.
3. The workflow builds every platform and attaches the installers to a **draft** GitHub release. Review it and publish.

Running the workflow manually (Actions → Release → Run workflow) builds the same installers and uploads them as workflow artifacts instead of a release.

## macOS signing and notarization

Without the secrets below, macOS builds are unsigned: they run, but users must right-click → Open the first time. With them, every binary is signed with your Developer ID and the hardened runtime, and the app is notarized by Apple.

Add these repository secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE` | Your **Developer ID Application** certificate exported as `.p12`, base64-encoded: `base64 -i certificate.p12 \| pbcopy` |
| `APPLE_CERTIFICATE_PASSWORD` | The password you set when exporting the `.p12` |
| `APPLE_SIGNING_IDENTITY` | The identity name, e.g. `Developer ID Application: Your Name (TEAMID1234)` |
| `APPLE_ID` | The Apple ID email used for notarization |
| `APPLE_PASSWORD` | An [app-specific password](https://support.apple.com/102654) for that Apple ID |
| `APPLE_TEAM_ID` | Your 10-character Team ID |

How the signing works:

- The bundle script (`apps/server/scripts/bundle.mjs`) signs the Node sidecar and the SQLite native module with the hardened runtime before Tauri bundles them.
- Node needs the entitlements in `apps/desktop/src-tauri/Entitlements.plist`: JIT for V8 and relaxed library validation to load the native module.
- Tauri then signs the app and the sidecar, and submits the app for notarization.

To check the signing setup locally without a certificate, build with an ad-hoc signature:

```sh
APPLE_SIGNING_IDENTITY=- pnpm build:app --bundles app
codesign --verify --deep --strict --verbose=2 apps/desktop/src-tauri/target/release/bundle/macos/Postguy.app
```

## Windows signing

Windows builds are unsigned, so SmartScreen warns on first run. To sign, add a code-signing certificate and set `bundle.windows.certificateThumbprint` (or a `signCommand` for a cloud signing service such as Azure Trusted Signing) in `apps/desktop/src-tauri/tauri.bundle.conf.json`. See the Tauri guide on Windows code signing.

## What the build includes

`pnpm build:app` (and the workflow) runs `apps/server/scripts/bundle.mjs` first, which:

- bundles the server into `src-tauri/resources/server` with the SQLite native module for the target platform only, QuickJS WebAssembly and database migrations;
- ships Node as the Tauri sidecar. It reuses the running Node when it is a self-contained build for the same platform; otherwise it downloads the official build of the same version from nodejs.org and verifies it against the published SHA-256 checksums. Downloads are cached in `src-tauri/.node-cache`.

The Node version comes from `.node-version`.
