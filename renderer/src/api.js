// Thin wrapper over the preload bridge. When running in a plain browser
// (no Electron preload), falls back to an in-memory demo so the UI can be
// previewed — no real crypto happens in demo mode.

export const isDemo = typeof window.pgp === 'undefined';

const demoKeys = [
  {
    fingerprint: 'A1B2C3D4E5F60718293A4B5C6D7E8F9012345678',
    keyID: '6D7E8F9012345678',
    userIDs: ['Travis Vu <ttha3928@gmail.com>'],
    isPrivate: true,
    needsPassphrase: true,
    unlocked: false,
    created: '2026-07-10T00:00:00.000Z',
    expires: null,
    algorithm: 'eddsaLegacy',
  },
  {
    fingerprint: 'FFEEDDCCBBAA99887766554433221100AABBCCDD',
    keyID: '33221100AABBCCDD',
    userIDs: ['Alice Example <alice@example.com>'],
    isPrivate: false,
    needsPassphrase: false,
    unlocked: false,
    created: '2025-03-14T00:00:00.000Z',
    expires: '2027-03-14T00:00:00.000Z',
    algorithm: 'eddsaLegacy',
  },
];

const DEMO_ARMORED = `-----BEGIN PGP MESSAGE-----

hF4DDEMOxDEMOxDEMOxDEMOxDEMOxDEMOxDEMOxDEMOxDEMOxDEMOxDEMOxDEMO
(browser demo mode — run inside the desktop app for real encryption)
=DEMO
-----END PGP MESSAGE-----`;

const demo = {
  listKeys: async () => [...demoKeys],
  generateKey: async ({ name, email }) => {
    demoKeys.push({
      ...demoKeys[0],
      fingerprint: Math.random().toString(16).slice(2).padEnd(40, '0').toUpperCase().slice(0, 40),
      userIDs: [`${name} <${email}>`],
    });
    return { status: 'added' };
  },
  importText: async () => [{ fingerprint: 'DEMO', userID: 'Demo import', status: 'added' }],
  importFile: async () => [],
  deleteKey: async ({ fingerprint }) => {
    const i = demoKeys.findIndex((k) => k.fingerprint === fingerprint);
    if (i >= 0) demoKeys.splice(i, 1);
    return true;
  },
  exportKey: async () => '-----BEGIN PGP PUBLIC KEY BLOCK-----\n(demo key)\n-----END PGP PUBLIC KEY BLOCK-----',
  exportKeyFile: async () => null,
  lockSession: async () => true,
  encrypt: async () => DEMO_ARMORED,
  decrypt: async () => ({
    text: 'This is a demo decryption. Run the desktop app for real crypto.',
    decryptedWith: demoKeys[0].fingerprint,
    signature: { valid: true, keyID: 'DEMO', signer: 'Alice Example <alice@example.com>' },
  }),
};

export async function call(name, payload) {
  if (isDemo) return demo[name](payload || {});
  const res = await window.pgp[name](payload);
  if (!res.ok) {
    const err = new Error(res.error);
    err.code = res.code;
    err.meta = res.meta;
    throw err;
  }
  return res.data;
}

// --- small shared helpers -------------------------------------------------

export function parseUserID(userID) {
  const match = /^(.*?)\s*<(.+)>$/.exec(userID || '');
  if (match) return { name: match[1] || match[2], email: match[2] };
  return { name: userID || '(no user ID)', email: '' };
}

export function keyLabel(key) {
  return parseUserID(key.userIDs[0]).name;
}

export function formatFingerprint(fpr) {
  return fpr.replace(/(.{4})/g, '$1 ').trim();
}

export function avatarHue(fpr) {
  return parseInt(fpr.slice(0, 6), 16) % 360;
}

export function initials(userID) {
  const { name } = parseUserID(userID);
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
