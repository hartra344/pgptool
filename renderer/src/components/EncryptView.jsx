import React, { useState } from 'react';
import { call, keyLabel } from '../api.js';
import RecipientPicker from './RecipientPicker.jsx';

export default function EncryptView({ active, keys, runWithPassphrase, toast }) {
  const [recipients, setRecipients] = useState([]);
  const [message, setMessage] = useState('');
  const [signer, setSigner] = useState('');
  const [output, setOutput] = useState('');
  const [busy, setBusy] = useState(false);

  const privateKeys = keys.filter((k) => k.isPrivate);

  const encrypt = async () => {
    if (!message.trim()) {
      toast('Write a message first', 'error');
      return;
    }
    if (recipients.length === 0) {
      toast('Add at least one recipient', 'error');
      return;
    }
    setBusy(true);
    try {
      const armored = await runWithPassphrase(({ passphrase }) =>
        call('encrypt', {
          text: message,
          recipientFingerprints: recipients,
          signerFingerprint: signer || null,
          passphrase,
        })
      );
      if (armored === null) return; // cancelled passphrase prompt
      setOutput(armored);
      toast(
        `Encrypted for ${recipients.length} recipient${recipients.length > 1 ? 's' : ''}` +
          (signer ? ', signed' : ''),
        'success'
      );
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(output);
    toast('Copied to clipboard', 'success');
  };

  return (
    <section className={'view' + (active ? ' active' : '')}>
      <header className="view-header">
        <h1>Encrypt a message</h1>
        <p className="sub">Everyone you address can open the same encrypted message.</p>
      </header>

      <div className="field">
        <label>To</label>
        <RecipientPicker keys={keys} selected={recipients} onChange={setRecipients} />
      </div>

      <div className="field grow">
        <label htmlFor="enc-input">Message</label>
        <textarea
          id="enc-input"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') encrypt();
          }}
          placeholder="Write your message…  (⌘/Ctrl + Enter to encrypt)"
        />
      </div>

      <div className="action-bar">
        <div className="sign-control">
          <label htmlFor="enc-signer">Sign as</label>
          <select id="enc-signer" value={signer} onChange={(e) => setSigner(e.target.value)}>
            <option value="">Don't sign</option>
            {privateKeys.map((k) => (
              <option key={k.fingerprint} value={k.fingerprint}>
                {keyLabel(k)}
              </option>
            ))}
          </select>
        </div>
        <div className="spacer" />
        <button className="btn primary" onClick={encrypt} disabled={busy}>
          {busy ? 'Encrypting…' : 'Encrypt'}
        </button>
      </div>

      {output && (
        <div className="result-card">
          <div className="result-head">
            <span>Encrypted message</span>
            <div className="result-actions">
              <button className="btn small" onClick={copy}>Copy</button>
              <button className="btn small ghost" onClick={() => setOutput('')}>Clear</button>
            </div>
          </div>
          <textarea className="mono output" readOnly value={output} rows={9} />
        </div>
      )}
    </section>
  );
}
