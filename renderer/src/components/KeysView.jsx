import React, { useState } from 'react';
import { avatarHue, formatFingerprint, initials, keyLabel, parseUserID } from '../api.js';

function KeyCard({ keyData, toast, onExport, onDelete }) {
  const name = keyLabel(keyData);
  const { email } = parseUserID(keyData.userIDs[0]);
  const hue = avatarHue(keyData.fingerprint);

  const copyFingerprint = async () => {
    await navigator.clipboard.writeText(keyData.fingerprint);
    toast('Fingerprint copied', 'success');
  };

  return (
    <div className="key-card">
      <div className="avatar" style={{ background: `hsl(${hue} 55% 45%)` }}>
        {initials(keyData.userIDs[0])}
      </div>
      <div className="key-info">
        <div className="key-name">
          {name}
          {keyData.isPrivate && (
            <span className={'dot ' + (keyData.unlocked ? 'green' : 'gray')}
                  title={keyData.unlocked ? 'Unlocked (passphrase cached)' : 'Locked'} />
          )}
        </div>
        {email && <div className="key-email">{email}</div>}
        <button className="key-fpr" onClick={copyFingerprint} title="Click to copy full fingerprint">
          {formatFingerprint(keyData.fingerprint)}
        </button>
        <div className="key-meta">
          {keyData.algorithm} · created {keyData.created.slice(0, 10)}
          {keyData.expires ? ` · expires ${keyData.expires.slice(0, 10)}` : ' · never expires'}
          {keyData.userIDs.length > 1 && ` · +${keyData.userIDs.length - 1} more identit${keyData.userIDs.length > 2 ? 'ies' : 'y'}`}
        </div>
      </div>
      <div className="key-actions">
        <button className="btn small" onClick={() => onExport(keyData, false)}>Share public</button>
        {keyData.isPrivate && (
          <button className="btn small" onClick={() => onExport(keyData, true)}>Backup private</button>
        )}
        <button className="btn small danger" onClick={() => onDelete(keyData)}>Delete</button>
      </div>
    </div>
  );
}

export default function KeysView({
  active, keys, toast, onGenerate, onImportFile, onImportPaste, onExport, onDelete, onExportAll,
}) {
  const [search, setSearch] = useState('');

  const q = search.trim().toLowerCase();
  const matches = (k) =>
    !q ||
    keyLabel(k).toLowerCase().includes(q) ||
    k.userIDs.join(' ').toLowerCase().includes(q) ||
    k.fingerprint.toLowerCase().includes(q.replace(/\s/g, ''));

  const mine = keys.filter((k) => k.isPrivate && matches(k));
  const contacts = keys.filter((k) => !k.isPrivate && matches(k));

  return (
    <section className={'view' + (active ? ' active' : '')}>
      <header className="view-header row-header">
        <div>
          <h1>Keys</h1>
          <p className="sub">Your keypairs and your contacts' public keys.</p>
        </div>
        <div className="header-actions">
          {keys.length > 0 && (
            <button className="btn" onClick={onExportAll} title="Back up or share your whole keyring">
              Export all…
            </button>
          )}
          <button className="btn" onClick={onImportFile}>Import file…</button>
          <button className="btn" onClick={onImportPaste}>Paste key…</button>
          <button className="btn primary" onClick={onGenerate}>＋ New keypair</button>
        </div>
      </header>

      {keys.length === 0 ? (
        <div className="empty-state">
          <svg viewBox="0 0 24 24" width="42" height="42" fill="none" stroke="currentColor"
               strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m21 2-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8Zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
          </svg>
          <h2>No keys yet</h2>
          <p>
            Generate your first keypair, or import keys you already have.
            <br />
            You can also drop <code>.asc</code> key files anywhere in this window.
          </p>
          <div className="row-center">
            <button className="btn primary" onClick={onGenerate}>Generate my keypair</button>
            <button className="btn" onClick={onImportFile}>Import existing keys</button>
          </div>
        </div>
      ) : (
        <>
          <input
            type="search"
            className="key-search"
            placeholder="Search keys…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <h2 className="section-title">
            My keys <span className="hint">can decrypt &amp; sign</span>
          </h2>
          {mine.length === 0 ? (
            <p className="section-empty">
              {q ? 'No matches.' : 'No private keys — generate one to receive encrypted messages.'}
            </p>
          ) : (
            <div className="key-list">
              {mine.map((k) => (
                <KeyCard key={k.fingerprint} keyData={k} toast={toast} onExport={onExport} onDelete={onDelete} />
              ))}
            </div>
          )}

          <h2 className="section-title">
            Contacts <span className="hint">public keys you can encrypt to</span>
          </h2>
          {contacts.length === 0 ? (
            <p className="section-empty">
              {q ? 'No matches.' : "No contacts yet — import someone's public key to message them."}
            </p>
          ) : (
            <div className="key-list">
              {contacts.map((k) => (
                <KeyCard key={k.fingerprint} keyData={k} toast={toast} onExport={onExport} onDelete={onDelete} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
