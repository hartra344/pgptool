const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const openpgp = require('openpgp');

// ---------------------------------------------------------------------------
// Key store: armored keys persisted as JSON in the app's userData directory.
// Private keys are stored in their armored form, which keeps them protected
// by their passphrase (if they have one). Passphrases are never persisted.
// ---------------------------------------------------------------------------

const storePath = () => path.join(app.getPath('userData'), 'keys.json');

function loadStore() {
  try {
    return JSON.parse(fs.readFileSync(storePath(), 'utf8'));
  } catch {
    return { keys: [] };
  }
}

function saveStore(store) {
  fs.mkdirSync(path.dirname(storePath()), { recursive: true });
  fs.writeFileSync(storePath(), JSON.stringify(store, null, 2), { mode: 0o600 });
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

ipcMain.handle('pgp:decrypt', wrap(async ({ armored, passphrase, fingerprint: targetFingerprint }) => {
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
    const { data, signatures } = await openpgp.decrypt({
      message,
      decryptionKeys: [decryptionKey],
      verificationKeys: verificationKeys.length ? verificationKeys : undefined,
    });

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
  throw firstError || new Error('Decryption failed');
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
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
