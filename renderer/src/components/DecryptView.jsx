import React, { useRef, useState } from 'react';
import { call, keyLabel } from '../api.js';

export default function DecryptView({ active, keys, runWithPassphrase, toast, onImportKey }) {
  const [input, setInput] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const looksLikeKey = input.includes('PGP PUBLIC KEY BLOCK') || input.includes('PGP PRIVATE KEY BLOCK');
  const looksLikeMessage = input.includes('BEGIN PGP MESSAGE');

  const decrypt = async (text) => {
    const armored = (text ?? input).trim();
    if (!armored) return;
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setResult(null);
    try {
      const res = await runWithPassphrase(({ passphrase, fingerprint }) =>
        call('decrypt', { armored, passphrase, fingerprint })
      );
      if (res !== null) setResult(res);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const onPaste = () => {
    // Let the paste land in the textarea first, then auto-decrypt.
    setTimeout(() => {
      const value = document.getElementById('dec-input').value;
      if (value.includes('BEGIN PGP MESSAGE')) decrypt(value);
    }, 0);
  };

  const decryptedWithKey = result && keys.find((k) => k.fingerprint === result.decryptedWith);

  return (
    <section className={'view' + (active ? ' active' : '')}>
      <header className="view-header">
        <h1>Decrypt a message</h1>
        <p className="sub">Paste an encrypted message — it decrypts automatically.</p>
      </header>

      <div className="field grow">
        <label htmlFor="dec-input">Encrypted message</label>
        <textarea
          id="dec-input"
          className="mono"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') decrypt();
          }}
          placeholder="Paste a -----BEGIN PGP MESSAGE----- block here…"
          spellCheck={false}
        />
      </div>

      {looksLikeKey && (
        <div className="hint-card">
          <span>
            This looks like a PGP <strong>key</strong>, not a message.
          </span>
          <button
            className="btn small primary"
            onClick={async () => {
              const ok = await onImportKey(input);
              if (ok) setInput('');
            }}
          >
            Import it
          </button>
        </div>
      )}

      <div className="action-bar">
        <div className="spacer" />
        {input && (
          <button className="btn ghost" onClick={() => { setInput(''); setResult(null); }}>
            Clear
          </button>
        )}
        <button className="btn primary" onClick={() => decrypt()} disabled={busy || !looksLikeMessage}>
          {busy ? 'Decrypting…' : 'Decrypt'}
        </button>
      </div>

      {result && (
        <div className="result-card">
          <div className="result-head">
            <span>Decrypted message</span>
            <div className="result-actions">
              <button
                className="btn small"
                onClick={async () => {
                  await navigator.clipboard.writeText(result.text);
                  toast('Copied to clipboard', 'success');
                }}
              >
                Copy
              </button>
            </div>
          </div>
          <div className="badge-row">
            {decryptedWithKey && (
              <span className="chip neutral" title={result.decryptedWith}>
                Decrypted with {keyLabel(decryptedWithKey)}
              </span>
            )}
            {result.signature === null && (
              <span className="chip warn">⚠ Not signed — sender can't be verified</span>
            )}
            {result.signature?.valid && (
              <span className="chip good">✓ Signed by {result.signature.signer}</span>
            )}
            {result.signature && !result.signature.valid && (
              <span className="chip bad">✗ Signature can't be verified (key {result.signature.keyID})</span>
            )}
          </div>
          <textarea className="output" readOnly value={result.text} rows={9} />
        </div>
      )}
    </section>
  );
}
