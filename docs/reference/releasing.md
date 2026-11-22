# Releasing Postguy

Installers are built by GitHub Actions (`.github/workflows/release.yml`) for:

| Platform | Target | Installers |
| --- | --- | --- |
| macOS, Apple Silicon | `aarch64-apple-darwin` | `.dmg`, `.app` |
| macOS, Intel | `x86_64-apple-darwin` | `.dmg`, `.app` |
| Windows | `x86_64-pc-windows-msvc` | `.msi`, NSIS `.exe` |
| Linux | `x86_64-unknown-linux-gnu` | `.deb`, `.rpm`, `.AppImage` |

## Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and every pull request:

- **test**: `pnpm typecheck` and `pnpm test` on Linux.
- **build**: after the tests pass, a debug build of the desktop app (server bundle, Node sidecar and Rust app, no installers) on macOS, Windows and Linux, so packaging breaks show up before a release.

A newer push to the same branch cancels the run in progress.

## Cutting a release

1. Bump `version` in `apps/desktop/src-tauri/tauri.conf.json` (and `Cargo.toml` and `apps/desktop/package.json` if you track it there).
2. In `CHANGELOG.md`, rename **Unreleased** to the new version (`## 0.2.0 – 2026-12-01`) and add an empty **Unreleased** above it. Write the notes for people using the app, not as a list of commits. Check what will be published with `node scripts/release-notes.mjs v0.2.0`.
3. Commit, then tag and push: `git tag v0.2.0 && git push origin v0.2.0`.
4. The workflow checks that the tag matches the version in `tauri.conf.json`, that `CHANGELOG.md` has a section for it, and runs the tests. It then builds every platform and attaches the installers to a **draft** GitHub release whose notes are that section. Review it and publish.

The same notes go into `latest.json`, so the in-app update message shows their first few points. The tests also fail when `CHANGELOG.md` has no section for the version in `tauri.conf.json`, so a version bump without notes is caught before tagging.

A tag with a suffix, such as `v0.2.0-beta.1`, creates a pre-release.

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

## Signed updates

Installed apps check the latest **published** release for `latest.json` and offer to update. Drafts and pre-releases are never offered. Each update is signed, and the app refuses one whose signature doesn't match the public key built into it.

Set this up once:

1. Generate a key pair, and keep the private key and its password somewhere safe. Losing them means existing installs can't be updated again.

   ```sh
   pnpm --filter @postguy/desktop tauri signer generate -w ~/.tauri/postguy.key
   ```

2. In the repository settings, add the secrets `TAURI_SIGNING_PRIVATE_KEY` (the contents of `~/.tauri/postguy.key`) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
3. Add the **variable** `TAURI_UPDATER_PUBKEY` with the contents of `~/.tauri/postguy.key.pub`.

From then on, the release workflow builds the update bundles and signatures and attaches `latest.json` to the release. Without these settings, releases still build, with a warning, and those installs don't update themselves.

Updates install on macOS, Windows and the Linux AppImage. `.deb` and `.rpm` installs are told about new versions and linked to the release.

Before an update's database migrations run, the app copies the database to `postguy.db.bak-before-<migration>` in its data folder, keeping the latest three copies.

## Documentation site

`.github/workflows/docs.yml` builds this site with VitePress and publishes it to GitHub Pages whenever `docs/` changes on `main`, or when run by hand. In the repository settings, set **Pages → Source** to **GitHub Actions** once. Preview locally with `pnpm docs:dev`.
