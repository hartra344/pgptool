const { app, BrowserWindow, ipcMain, dialog, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

// Electron's Node is backed by BoringSSL, which has no AES-KW support. Node's
// WebCrypto only fails once the wrap/unwrap operation runs (a generic
// OperationError), which openpgp.js misreads as tampering and reports as
// "Key Data Integrity failed" on every ECDH decrypt. openpgp.js falls back to
// its pure-JS AES-KW only when the key *import* throws NotSupportedError — so
// reject AES-KW imports up front to route it there.
const { webcrypto } = require('crypto');
const originalImportKey = webcrypto.subtle.importKey.bind(webcrypto.subtle);
webcrypto.subtle.importKey = (format, keyData, algorithm, ...rest) => {
  if ((algorithm?.name || algorithm) === 'AES-KW') {
    const err = new Error('AES-KW is not supported by BoringSSL');
    err.name = 'NotSupportedError';
    return Promise.reject(err);
  }
  return originalImportKey(format, keyData, algorithm, ...rest);
};

const openpgp = require('openpgp');
const { autoUpdater } = require('electron-updater');

// ---------------------------------------------------------------------------
// Key store: armored keys persisted in the app's userData directory. The whole
// store is encrypted at rest with the OS keychain (Keychain on macOS, DPAPI on
// Windows) via Electron's safeStorage, written as { sealed: <base64> }. Older
// plaintext { keys: [...] } stores are still readable and get sealed on the
// next save. Passphrases are never persisted.
// ---------------------------------------------------------------------------

const storePath = () => path.join(app.getPath('userData'), 'keys.json');

function loadStore() {
  let raw;
  try {
    raw = fs.readFileSync(storePath(), 'utf8');
  } catch {
    return { keys: [] }; // no store yet
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Don't fall back to an empty store here: a later save would wipe the
    // (possibly recoverable) keyring.
    throw new Error(`Key store is unreadable — inspect ${storePath()}`);
  }
  if (parsed && typeof parsed.sealed === 'string') {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('The key store is encrypted with the OS keychain, which is unavailable right now');
    }
    try {
      return JSON.parse(safeStorage.decryptString(Buffer.from(parsed.sealed, 'base64')));
    } catch {
      throw new Error('Could not decrypt the key store with the OS keychain');
    }
  }
  return Array.isArray(parsed?.keys) ? parsed : { keys: [] };
}

function saveStore(store) {
  fs.mkdirSync(path.dirname(storePath()), { recursive: true });
  const json = JSON.stringify(store, null, 2);
  const payload = safeStorage.isEncryptionAvailable()
    ? JSON.stringify({ sealed: safeStorage.encryptString(json).toString('base64') })
    : json;
  fs.writeFileSync(storePath(), payload, { mode: 0o600 });
}

// Seal a pre-existing plaintext store the first time this version runs.
function migrateStoreToSealed() {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
    if (Array.isArray(parsed?.keys) && safeStorage.isEncryptionAvailable()) {
      saveStore(parsed);
    }
  } catch {
    // No store yet, or unreadable — surfaced properly on first real access.
  }
}

// ---------------------------------------------------------------------------
// Session unlock cache: successfully unlocked private keys stay usable for
// UNLOCK_TTL_MS so the user isn't asked for the passphrase on every action.
// Held in main-process memory only; cleared on lock or app quit.
// ---------------------------------------------------------------------------

const UNLOCK_TTL_MS = 5 * 60 * 1000;
const unlockedKeys = new Map(); // fingerprint -> { key, until }

function getCachedUnlock(fingerprint) {
  const entry = unlockedKeys.get(fingerprint);
  if (!entry) return null;
  if (Date.now() > entry.until) {
    unlockedKeys.delete(fingerprint);
    return null;
  }
  entry.until = Date.now() + UNLOCK_TTL_MS; // sliding expiry
  return entry.key;
}

function cacheUnlock(fingerprint, key) {
  unlockedKeys.set(fingerprint, { key, until: Date.now() + UNLOCK_TTL_MS });
}

async function keyMeta(entry) {
  const key = await openpgp.readKey({ armoredKey: entry.armored });
  const expiration = await key.getExpirationTime().catch(() => null);
  const fingerprint = key.getFingerprint().toUpperCase();
  return {
    fingerprint,
    keyID: key.getKeyID().toHex().toUpperCase(),
    userIDs: key.getUserIDs(),
    isPrivate: key.isPrivate(),
    needsPassphrase: key.isPrivate() && !key.isDecrypted(),
    unlocked: key.isPrivate() && (!!getCachedUnlock(fingerprint) || key.isDecrypted()),
    created: key.getCreationTime().toISOString(),
    expires: expiration instanceof Date ? expiration.toISOString() : null,
    algorithm: key.getAlgorithmInfo().algorithm,
  };
}

// Decode the key-flags bitfield from the most recent signature that has one.
function usageFromSignatures(signatures) {
  const withFlags = (signatures || []).filter((s) => s?.keyFlags?.length);
  if (withFlags.length === 0) return [];
  withFlags.sort((a, b) => (b.created?.getTime() || 0) - (a.created?.getTime() || 0));
  const flags = withFlags[0].keyFlags[0];
  const usage = [];
  if (flags & 0x01) usage.push('certify');
  if (flags & 0x02) usage.push('sign');
  if (flags & 0x0c) usage.push('encrypt');
  if (flags & 0x20) usage.push('authenticate');
  return usage;
}

function algorithmLabel(info) {
  if (info.curve) return `${info.algorithm} (${info.curve})`;
  if (info.bits) return `${info.algorithm} (${info.bits}-bit)`;
  return info.algorithm;
}

async function keyDetails(entry) {
  const key = await openpgp.readKey({ armoredKey: entry.armored });
  const meta = await keyMeta(entry);

  const describe = async (k, usage) => {
    const expiration = k === key ? meta.expires
      : await k.getExpirationTime().then((d) => (d instanceof Date ? d.toISOString() : null)).catch(() => null);
    return {
      keyID: k.getKeyID().toHex().toUpperCase(),
      fingerprint: k.getFingerprint().toUpperCase(),
      algorithm: algorithmLabel(k.getAlgorithmInfo()),
      created: k.getCreationTime().toISOString(),
      expires: expiration,
      usage,
    };
  };

  const primaryUsage = usageFromSignatures(
    key.users.flatMap((u) => u.selfCertifications || [])
  );
  const subkeys = [];
  for (const sub of key.getSubkeys()) {
    subkeys.push(await describe(sub, usageFromSignatures(sub.bindingSignatures)));
  }
  return {
    ...meta,
    added: entry.added,
    primary: await describe(key, primaryUsage),
    subkeys,
  };
}

async function addKeyToStore(store, armored) {
  const key = await openpgp.readKey({ armoredKey: armored });
  const fingerprint = key.getFingerprint().toUpperCase();
  const existing = store.keys.find((k) => k.fingerprint === fingerprint);
  if (existing) {
    // Upgrade a stored public key to private if the import contains the secret.
    if (key.isPrivate() && !existing.isPrivate) {
      existing.armored = armored;
      existing.isPrivate = true;
      return { fingerprint, userID: key.getUserIDs()[0] || '', status: 'upgraded' };
    }
    return { fingerprint, userID: key.getUserIDs()[0] || '', status: 'duplicate' };
  }
  store.keys.push({
    fingerprint,
    armored,
    isPrivate: key.isPrivate(),
    added: new Date().toISOString(),
  });
  return { fingerprint, userID: key.getUserIDs()[0] || '', status: 'added' };
}

async function importArmoredBlock(armoredText) {
  // readKeys only parses one armored block, so split the input into blocks
  // first — users often paste several "-----BEGIN ... END-----" keys at once.
  const blocks = armoredText.match(
    /-----BEGIN PGP (?:PUBLIC|PRIVATE) KEY BLOCK-----[\s\S]*?-----END PGP (?:PUBLIC|PRIVATE) KEY BLOCK-----/g
  );
  if (!blocks || blocks.length === 0) {
    throw new Error('No PGP key block found in the input');
  }
  const store = loadStore();
  const results = [];
  for (const block of blocks) {
    const keys = await openpgp.readKeys({ armoredKeys: block });
    for (const key of keys) {
      results.push(await addKeyToStore(store, key.armor()));
    }
  }
  saveStore(store);
  return results;
}

async function getStoredKey(fingerprint) {
  const entry = loadStore().keys.find((k) => k.fingerprint === fingerprint);
  if (!entry) throw new Error(`No stored key with fingerprint ${fingerprint}`);
  return entry;
}

// Unlock a private key, using the session cache when possible. Throws
// PASSPHRASE_REQUIRED (with key info in err.meta) when a passphrase is needed
// but none was supplied, so the UI can prompt for the right key.
async function unlockPrivateKey(entry, passphrase) {
  const cached = getCachedUnlock(entry.fingerprint);
  if (cached) return cached;

  const privateKey = await openpgp.readPrivateKey({ armoredKey: entry.armored });
  if (privateKey.isDecrypted()) return privateKey;

  const meta = {
    fingerprint: entry.fingerprint,
    userID: privateKey.getUserIDs()[0] || entry.fingerprint,
  };
  if (!passphrase) {
    const err = new Error('Passphrase required');
    err.code = 'PASSPHRASE_REQUIRED';
    err.meta = meta;
    throw err;
  }
  try {
    const unlocked = await openpgp.decryptKey({ privateKey, passphrase });
    cacheUnlock(entry.fingerprint, unlocked);
    return unlocked;
  } catch {
    const err = new Error('Incorrect passphrase');
    err.code = 'BAD_PASSPHRASE';
    err.meta = meta;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

function wrap(handler) {
  return async (_event, ...args) => {
    try {
      return { ok: true, data: await handler(...args) };
    } catch (err) {
      return { ok: false, error: err.message, code: err.code || null, meta: err.meta || null };
    }
  };
}

ipcMain.handle('keys:list', wrap(async () => {
  const store = loadStore();
  const list = [];
  for (const entry of store.keys) {
    list.push({ ...(await keyMeta(entry)), added: entry.added });
  }
  return list;
}));

ipcMain.handle('keys:details', wrap(async ({ fingerprint }) => {
  return keyDetails(await getStoredKey(fingerprint));
}));

ipcMain.handle('keys:generate', wrap(async ({ name, email, passphrase, anonymous }) => {
  if (!anonymous && (!name || !email)) throw new Error('Name and email are required');
  if (!passphrase) throw new Error('A passphrase is required to protect the private key');
  const { privateKey } = await openpgp.generateKey({
    type: 'ecc',
    curve: 'curve25519Legacy',
    // An empty user ID yields a key with no embedded identity.
    userIDs: [anonymous ? {} : { name, email }],
    passphrase,
    format: 'armored',
  });
  const store = loadStore();
  const result = await addKeyToStore(store, privateKey);
  saveStore(store);
  return result;
}));

ipcMain.handle('keys:importText', wrap(async ({ armored }) => {
  return importArmoredBlock(armored);
}));

ipcMain.handle('keys:importFile', wrap(async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Import PGP key file(s)',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'PGP keys', extensions: ['asc', 'pgp', 'gpg', 'key', 'txt'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (canceled) return [];
  const results = [];
  for (const filePath of filePaths) {
    const text = fs.readFileSync(filePath, 'utf8');
    try {
      results.push(...(await importArmoredBlock(text)));
    } catch (err) {
      results.push({ fingerprint: path.basename(filePath), userID: '', status: `failed: ${err.message}` });
    }
  }
  return results;
}));

ipcMain.handle('keys:delete', wrap(async ({ fingerprint }) => {
  const store = loadStore();
  const before = store.keys.length;
  store.keys = store.keys.filter((k) => k.fingerprint !== fingerprint);
  if (store.keys.length === before) throw new Error('Key not found');
  saveStore(store);
  unlockedKeys.delete(fingerprint);
  return true;
}));

async function exportArmored(fingerprint, includePrivate) {
  const entry = await getStoredKey(fingerprint);
  if (includePrivate) {
    if (!entry.isPrivate) throw new Error('No private key stored for this fingerprint');
    return entry.armored;
  }
  const key = await openpgp.readKey({ armoredKey: entry.armored });
  return key.isPrivate() ? key.toPublic().armor() : key.armor();
}

ipcMain.handle('keys:export', wrap(async ({ fingerprint, includePrivate }) => {
  return exportArmored(fingerprint, includePrivate);
}));

ipcMain.handle('keys:exportFile', wrap(async ({ fingerprint, includePrivate, suggestedName }) => {
  const armored = await exportArmored(fingerprint, includePrivate);
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: includePrivate ? 'Save private key' : 'Save public key',
    defaultPath: suggestedName || 'key.asc',
    filters: [{ name: 'ASCII-armored key', extensions: ['asc'] }],
  });
  if (canceled || !filePath) return null;
  fs.writeFileSync(filePath, armored, { mode: includePrivate ? 0o600 : 0o644 });
  return filePath;
}));

ipcMain.handle('keys:exportAll', wrap(async ({ includePrivate }) => {
  const store = loadStore();
  if (store.keys.length === 0) throw new Error('No keys to export');
  // One .asc file of concatenated armored blocks — restorable by this app's
  // import (which splits blocks) and by GnuPG (gpg --import).
  const parts = [];
  let privCount = 0;
  let pubCount = 0;
  for (const entry of store.keys) {
    if (entry.isPrivate && includePrivate) {
      parts.push(entry.armored.trim());
      privCount += 1;
    } else {
      const key = await openpgp.readKey({ armoredKey: entry.armored });
      parts.push((key.isPrivate() ? key.toPublic() : key).armor().trim());
      pubCount += 1;
    }
  }
  const date = new Date().toISOString().slice(0, 10);
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: includePrivate ? 'Save keyring backup' : 'Save public keys',
    defaultPath: includePrivate
      ? `pgptool-backup-${date}.asc`
      : `pgptool-public-keys-${date}.asc`,
    filters: [{ name: 'ASCII-armored keys', extensions: ['asc'] }],
  });
  if (canceled || !filePath) return null;
  fs.writeFileSync(filePath, parts.join('\n\n') + '\n', { mode: includePrivate ? 0o600 : 0o644 });
  return { path: filePath, privCount, pubCount };
}));

ipcMain.handle('session:lock', wrap(async () => {
  unlockedKeys.clear();
  return true;
}));

ipcMain.handle('pgp:encrypt', wrap(async ({ text, recipientFingerprints, signerFingerprint, passphrase }) => {
  if (!text) throw new Error('Nothing to encrypt');
  if (!recipientFingerprints || recipientFingerprints.length === 0) {
    throw new Error('Select at least one recipient');
  }
  const encryptionKeys = [];
  for (const fp of recipientFingerprints) {
    const entry = await getStoredKey(fp);
    const key = await openpgp.readKey({ armoredKey: entry.armored });
    encryptionKeys.push(key.isPrivate() ? key.toPublic() : key);
  }
  let signingKeys;
  if (signerFingerprint) {
    const entry = await getStoredKey(signerFingerprint);
    if (!entry.isPrivate) throw new Error('Signing key has no private part');
    signingKeys = [await unlockPrivateKey(entry, passphrase)];
  }
  return openpgp.encrypt({
    message: await openpgp.createMessage({ text }),
    encryptionKeys,
    signingKeys,
  });
}));

async function decryptMessage({ armored, passphrase, fingerprint: targetFingerprint }) {
  let message;
  try {
    message = await openpgp.readMessage({ armoredMessage: armored });
  } catch {
    throw new Error('Not a valid PGP message');
  }
  const neededKeyIDs = message.getEncryptionKeyIDs().map((id) => id.toHex());
  const store = loadStore();

  // Find stored private keys whose (sub)key IDs match what the message needs.
  const candidates = [];
  for (const entry of store.keys.filter((k) => k.isPrivate)) {
    const key = await openpgp.readPrivateKey({ armoredKey: entry.armored });
    const ids = key.getKeys().map((k) => k.getKeyID().toHex());
    if (neededKeyIDs.some((id) => ids.includes(id) || id === '0000000000000000')) {
      candidates.push(entry);
    }
  }
  if (candidates.length === 0) {
    throw new Error('This message was not encrypted for any of your private keys');
  }
  // If the UI is retrying with a passphrase for a specific key, try it first.
  if (targetFingerprint) {
    candidates.sort((a, b) =>
      (b.fingerprint === targetFingerprint) - (a.fingerprint === targetFingerprint));
  }

  // Collect all known public keys for signature verification.
  const verificationKeys = [];
  for (const entry of store.keys) {
    const key = await openpgp.readKey({ armoredKey: entry.armored });
    verificationKeys.push(key.isPrivate() ? key.toPublic() : key);
  }

  let firstError;
  for (const entry of candidates) {
    let decryptionKey;
    try {
      const pass = entry.fingerprint === targetFingerprint ? passphrase : null;
      decryptionKey = await unlockPrivateKey(entry, pass || passphrase);
    } catch (err) {
      firstError = firstError || err;
      continue;
    }
    let data, signatures;
    try {
      // Re-parse per attempt: a message's packet data is stream-backed and
      // gets consumed by a failed decrypt, so the object is single-use.
      ({ data, signatures } = await openpgp.decrypt({
        message: await openpgp.readMessage({ armoredMessage: armored }),
        decryptionKeys: [decryptionKey],
        verificationKeys: verificationKeys.length ? verificationKeys : undefined,
      }));
    } catch (err) {
      // This key couldn't open the message. With hidden recipient IDs
      // (gpg --throw-keyids) every private key is a candidate, so failures
      // here are expected — move on to the next key.
      firstError = firstError || err;
      continue;
    }

    let signature = null;
    if (signatures && signatures.length > 0) {
      const sig = signatures[0];
      try {
        await sig.verified;
        const signerID = sig.keyID.toHex().toUpperCase();
        const signer = verificationKeys.find((k) =>
          k.getKeys().some((sk) => sk.getKeyID().toHex().toUpperCase() === signerID)
        );
        signature = {
          valid: true,
          keyID: signerID,
          signer: signer ? signer.getUserIDs()[0] : 'Unknown key',
        };
      } catch {
        signature = { valid: false, keyID: sig.keyID.toHex().toUpperCase(), signer: null };
      }
    }
    return { text: data, decryptedWith: entry.fingerprint, signature };
  }
  // Passphrase problems keep their code + meta so the UI can prompt.
  if (firstError?.code) throw firstError;
  const err = new Error(
    'Could not decrypt this message with any of your private keys — it may have been ' +
    'encrypted to a different key, or the message text is damaged' +
    (firstError ? ` (${firstError.message.replace(/^Error decrypting message: /, '')})` : '')
  );
  throw err;
}

ipcMain.handle('pgp:decrypt', wrap(decryptMessage));

// ---------------------------------------------------------------------------
// Auto-update: checks the GitHub release feed on launch, downloads in the
// background, and lets the renderer offer a "restart to update" action.
// Only active in packaged builds — dev runs report the updater as unavailable.
// ---------------------------------------------------------------------------

const updaterAvailable = () => app.isPackaged;
const updateState = { status: 'idle', version: null, error: null };

function setUpdateState(status, version = null, error = null) {
  Object.assign(updateState, { status, version, error });
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('update:state', { ...updateState });
  }
}

function setupAutoUpdater() {
  if (!updaterAvailable()) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => setUpdateState('checking'));
  autoUpdater.on('update-available', (info) => setUpdateState('downloading', info.version));
  autoUpdater.on('update-not-available', () => setUpdateState('up-to-date'));
  autoUpdater.on('update-downloaded', (info) => setUpdateState('ready', info.version));
  autoUpdater.on('error', (err) => setUpdateState('error', null, err.message));
  autoUpdater.checkForUpdates().catch(() => {
    // Startup check is best-effort (offline, private repo, …) — the 'error'
    // event above already recorded the failure.
  });
}

ipcMain.handle('app:info', wrap(async () => ({
  version: app.getVersion(),
  updaterAvailable: updaterAvailable(),
  updateState: { ...updateState },
})));

ipcMain.handle('update:check', wrap(async () => {
  if (!updaterAvailable()) throw new Error('Updates only work in the installed app');
  await autoUpdater.checkForUpdates();
  return { ...updateState };
}));

ipcMain.handle('update:install', wrap(async () => {
  if (updateState.status !== 'ready') throw new Error('No update has been downloaded yet');
  autoUpdater.quitAndInstall();
  return true;
}));

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function createWindow() {
  const win = new BrowserWindow({
    width: 1150,
    height: 780,
    minWidth: 860,
    minHeight: 600,
    title: 'PGP Tool',
    backgroundColor: '#101317',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, '..', 'renderer', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  migrateStoreToSealed();
  setupAutoUpdater();
  if (!process.env.PGPTOOL_HEADLESS_TEST) createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Exposed for the headless test harness (PGPTOOL_HEADLESS_TEST).
module.exports = { loadStore, saveStore, migrateStoreToSealed, keyDetails, decryptMessage };
