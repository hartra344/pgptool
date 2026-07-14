import React, { useEffect, useState } from 'react';
import { avatarHue, call, formatFingerprint, initials, keyLabel } from '../api.js';
import { ModalShell } from './Modals.jsx';

const USAGE_LABELS = {
  certify: 'Certify',
  sign: 'Sign',
  encrypt: 'Encrypt',
  authenticate: 'Authenticate',
};

function KeyRow({ title, data }) {
  return (
    <div className="subkey-row">
      <div className="subkey-head">
        <span className="subkey-title">{title}</span>
        {(data.usage || []).map((u) => (
          <span key={u} className="usage-badge">{USAGE_LABELS[u] || u}</span>
        ))}
      </div>
      <div className="subkey-meta">
        <span className="mono-inline">{data.keyID}</span>
        {' · '}{data.algorithm}
        {' · created '}{data.created.slice(0, 10)}
        {data.expires ? ` · expires ${data.expires.slice(0, 10)}` : ' · never expires'}
      </div>
    </div>
  );
}

export default function KeyDetailModal({ keyData, toast, onExport, onDelete, onClose }) {
  const [details, setDetails] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let stale = false;
    call('keyDetails', { fingerprint: keyData.fingerprint })
      .then((d) => !stale && setDetails(d))
      .catch((err) => !stale && setError(err.message));
    return () => {
      stale = true;
    };
  }, [keyData.fingerprint]);

  const copyFingerprint = async () => {
    await navigator.clipboard.writeText(keyData.fingerprint);
    toast('Fingerprint copied', 'success');
  };

  const hue = avatarHue(keyData.fingerprint);

  return (
    <ModalShell onClose={onClose} wide>
      <div className="detail-header">
        <div className="avatar large" style={{ background: `hsl(${hue} 55% 45%)` }}>
          {initials(keyData.userIDs[0])}
        </div>
        <div className="detail-title">
          <h2>{keyLabel(keyData)}</h2>
          <p className="modal-sub">
            {keyData.isPrivate ? 'Keypair — can decrypt & sign' : 'Public key — encrypt-only contact'}
            {keyData.isPrivate && (keyData.unlocked ? ' · unlocked' : ' · locked')}
          </p>
        </div>
      </div>

      {keyData.userIDs.filter(Boolean).length > 0 && (
        <div className="detail-section">
          <h3 className="detail-label">Identities</h3>
          {keyData.userIDs.filter(Boolean).map((uid) => (
            <div key={uid} className="detail-uid">{uid}</div>
          ))}
        </div>
      )}

      <div className="detail-section">
        <h3 className="detail-label">Fingerprint</h3>
        <button className="detail-fpr" onClick={copyFingerprint} title="Click to copy">
          {formatFingerprint(keyData.fingerprint)}
        </button>
        <p className="modal-note">
          Compare this out-of-band (call, in person) with your contact's copy to verify the key
          really belongs to them. Click to copy.
        </p>
      </div>

      <div className="detail-section">
        <h3 className="detail-label">Keys</h3>
        {error && <p className="form-error">{error}</p>}
        {!details && !error && <p className="modal-note">Loading key material…</p>}
        {details && (
          <>
            <KeyRow title="Primary key" data={details.primary} />
            {details.subkeys.map((sub) => (
              <KeyRow key={sub.keyID} title="Subkey" data={sub} />
            ))}
          </>
        )}
        {details?.added && (
          <p className="modal-note">Added to your keyring {details.added.slice(0, 10)}.</p>
        )}
      </div>

      <div className="modal-actions">
        <button className="btn danger" onClick={() => onDelete(keyData)}>Delete</button>
        <div className="spacer" />
        <button className="btn" onClick={() => onExport(keyData, false)}>Share public</button>
        {keyData.isPrivate && (
          <button className="btn" onClick={() => onExport(keyData, true)}>Backup private</button>
        )}
        <button className="btn primary" onClick={onClose}>Done</button>
      </div>
    </ModalShell>
  );
}
