# PGP Tool

A cross-platform desktop app (macOS Apple Silicon + Windows) for managing PGP keys and encrypting/decrypting messages. Electron + React (Vite) UI, with all crypto handled by [openpgp.js](https://openpgpjs.org/) in the main process.

## Features

- **Generate keypairs** (ECC curve25519, passphrase-protected)
- **Import keys** — paste armored text, pick `.asc`/`.gpg` files, or **drag & drop key files** anywhere in the window
- **Email-style recipient picker** — type-ahead search, encrypt to **any number of recipients at once**
- **Sign** messages with your private key (optional)
- **Auto-decrypt on paste** — finds which of your private keys the message was encrypted for
- **Passphrase prompts only when needed**, with a 5-minute session unlock cache and a manual "Lock keys" button
- **Signature verification** — shows who signed a decrypted message, warns on unsigned ones
- **Export** — share public keys, back up private keys (copy or save as `.asc`)
- **Export/import the whole keyring** — one `.asc` bundle (full backup with private keys, or public-only for sharing); restore via "Import file…" or `gpg --import`
- **Key detail view** — click any key to see its identities, a large copyable fingerprint for out-of-band verification, and the primary key + subkeys with their capabilities
- **Encrypted key store** — the keyring file is sealed with the OS keychain (macOS Keychain / Windows DPAPI) at rest
- **Auto-update** — installed builds check GitHub Releases on launch, download in the background, and offer "Restart to update" (see caveats below)
- Light/dark theme following the system

## Development

```bash
npm install
npm run dev     # Vite dev server + Electron; UI hot-reloads, Electron auto-restarts on src/ changes
npm start       # production build + Electron
```

Opening the Vite dev server in a plain browser shows the UI in **demo mode** (mock crypto, "DEMO" badge) — real crypto only runs inside Electron.

## Build installers

```bash
npm run dist:mac   # .dmg + .zip for macOS arm64 (run on a Mac)
npm run dist:win   # NSIS installer for Windows x64
```

`dist:win` can be run from macOS (electron-builder cross-compiles NSIS installers), but building on a real Windows machine is more reliable if you hit issues. Output lands in `dist/`.

Note: the macOS build is unsigned by default. To distribute it beyond your own machine you'll want to configure code signing / notarization in the `build.mac` section of `package.json`; for personal use, right-click → Open bypasses Gatekeeper.

## Architecture

- `src/main.js` — Electron main process: key store, session unlock cache, all openpgp operations, IPC handlers
- `src/preload.js` — minimal `window.pgp` bridge (context isolation + sandbox enabled)
- `renderer/` — React app (Vite); talks to main only through the bridge

## Auto-update caveats

- The updater reads release metadata from this GitHub repo. **It only works if the repo is public** — against a private repo the startup check fails quietly and "Check for updates" reports an error.
- On **macOS**, installing updates requires the app to be code-signed; unsigned builds can check and download but the install will fail. **Windows** NSIS builds update fine unsigned.
- The release workflow uploads `latest*.yml` + `.blockmap` metadata alongside the installers — the updater needs those files on each release.

## Security notes

- Keys live in `keys.json` under the app's user-data directory (`~/Library/Application Support/pgptool` on macOS, `%APPDATA%/pgptool` on Windows). The whole file is encrypted at rest with the OS keychain (Electron `safeStorage`); older plaintext stores are sealed automatically on first launch.
- Independently of the store encryption, private keys stay passphrase-encrypted. **If you import a private key that has no passphrase, only the store-level encryption protects it** — consider adding a passphrase to it first (e.g. `gpg --edit-key <id> passwd`).
- Passphrases are used transiently; successful unlocks are cached in main-process memory for 5 minutes (sliding), cleared by "Lock keys" or quitting.
