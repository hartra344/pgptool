import React, { useEffect, useRef, useState } from 'react';
import { call, isDemo, keyLabel, parseUserID } from '../api.js';

function ModalShell({ children, onClose, wide }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '')}>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function PassphraseModal({ userID, error, onSubmit, onCancel }) {
  const [value, setValue] = useState('');
  const inputRef = useRef(null);
  useEffect(() => inputRef.current?.focus(), []);

  const submit = () => {
    if (value) onSubmit(value);
  };

  return (
    <ModalShell onClose={onCancel}>
      <h2>Unlock key</h2>
      <p className="modal-sub">
        Enter the passphrase for <strong>{userID}</strong>
      </p>
      <input
        ref={inputRef}
        type="password"
        placeholder="Passphrase"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        autoComplete="off"
      />
      {error && <p className="form-error">{error}</p>}
      <p className="modal-note">Stays unlocked for 5 minutes, then locks automatically.</p>
      <div className="modal-actions">
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
        <button className="btn primary" onClick={submit} disabled={!value}>Unlock</button>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------

export function ConfirmModal({ title, body, confirmLabel, danger, onResult }) {
  return (
    <ModalShell onClose={() => onResult(false)}>
      <h2>{title}</h2>
      <p className="modal-sub">{body}</p>
      <div className="modal-actions">
        <button className="btn ghost" onClick={() => onResult(false)} autoFocus>Cancel</button>
        <button className={'btn ' + (danger ? 'danger-solid' : 'primary')} onClick={() => onResult(true)}>
          {confirmLabel || 'Confirm'}
        </button>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------

export function GenerateModal({ onClose, onDone }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef(null);
  useEffect(() => nameRef.current?.focus(), []);

  const generate = async () => {
    if (!anonymous && (!name.trim() || !email.trim())) return setError('Name and email are required.');
    if (pass.length < 8) return setError('Use a passphrase of at least 8 characters.');
    if (pass !== pass2) return setError('Passphrases do not match.');
    setError(null);
    setBusy(true);
    try {
      await call('generateKey', {
        name: name.trim(),
        email: email.trim(),
        passphrase: pass,
        anonymous,
      });
      onDone(anonymous ? 'Anonymous keypair' : `Keypair for ${name.trim()}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <ModalShell onClose={() => !busy && onClose()}>
      <h2>New keypair</h2>
      <p className="modal-sub">Creates a modern ECC (Curve25519) key, protected by your passphrase.</p>
      <div className="form-grid">
        <input ref={nameRef} type="text" placeholder="Name" value={name} disabled={anonymous}
               onChange={(e) => setName(e.target.value)} autoComplete="off" />
        <input type="email" placeholder="Email" value={email} disabled={anonymous}
               onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        <input type="password" placeholder="Passphrase (min 8 characters)" value={pass}
               onChange={(e) => setPass(e.target.value)} autoComplete="off" />
        <input type="password" placeholder="Confirm passphrase" value={pass2}
               onChange={(e) => setPass2(e.target.value)} autoComplete="off"
               onKeyDown={(e) => e.key === 'Enter' && generate()} />
      </div>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={anonymous}
          onChange={(e) => setAnonymous(e.target.checked)}
        />
        <span>
          Anonymous key — no name or email embedded in the key
        </span>
      </label>
      <p className="modal-note">
        There is no way to recover a forgotten passphrase — store it somewhere safe.
      </p>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn primary" onClick={generate} disabled={busy}>
          {busy ? 'Generating…' : 'Generate'}
        </button>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------

export function PasteModal({ initialText, onClose, onImport }) {
  const [text, setText] = useState(initialText || '');
  const ref = useRef(null);
  useEffect(() => ref.current?.focus(), []);

  return (
    <ModalShell onClose={onClose} wide>
      <h2>Import keys</h2>
      <p className="modal-sub">Paste one or more armored key blocks — public or private.</p>
      <textarea
        ref={ref}
        className="mono"
        rows={10}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="-----BEGIN PGP PUBLIC KEY BLOCK-----"
        spellCheck={false}
      />
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!text.includes('BEGIN PGP')} onClick={() => onImport(text)}>
          Import
        </button>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------

export function ExportModal({ exportReq, toast, onClose }) {
  const { key, includePrivate, armored } = exportReq;
  const { email } = parseUserID(key.userIDs[0]);

  const save = async () => {
    const base = (email || keyLabel(key)).replace(/[^\w.@-]+/g, '_');
    const path = await call('exportKeyFile', {
      fingerprint: key.fingerprint,
      includePrivate,
      suggestedName: `${base}${includePrivate ? '_PRIVATE' : ''}.asc`,
    });
    if (path) toast(`Saved to ${path}`, 'success');
  };

  return (
    <ModalShell onClose={onClose} wide>
      <h2>{includePrivate ? 'Private key — keep this safe' : 'Public key — safe to share'}</h2>
      <p className="modal-sub">
        {keyLabel(key)}
        {includePrivate
          ? ' · anyone with this key and its passphrase can read your messages.'
          : ' · send this to people so they can encrypt messages to you.'}
      </p>
      <textarea className="mono" readOnly rows={12} value={armored} onFocus={(e) => e.target.select()} />
      <div className="modal-actions">
        {!isDemo && <button className="btn" onClick={save}>Save as file…</button>}
        <div className="spacer" />
        <button
          className="btn"
          onClick={async () => {
            await navigator.clipboard.writeText(armored);
            toast('Copied to clipboard', 'success');
          }}
        >
          Copy
        </button>
        <button className="btn primary" onClick={onClose}>Done</button>
      </div>
    </ModalShell>
  );
}
