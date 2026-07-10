import React, { useMemo, useRef, useState } from 'react';
import { avatarHue, initials, keyLabel, parseUserID } from '../api.js';

// Email-style "To:" field: selected keys shown as removable pills, with a
// type-ahead dropdown over the whole keyring.
export default function RecipientPicker({ keys, selected, onChange }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef(null);

  const selectedKeys = selected
    .map((fp) => keys.find((k) => k.fingerprint === fp))
    .filter(Boolean);

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return keys
      .filter((k) => !selected.includes(k.fingerprint))
      .filter(
        (k) =>
          !q ||
          keyLabel(k).toLowerCase().includes(q) ||
          k.userIDs.join(' ').toLowerCase().includes(q) ||
          k.fingerprint.toLowerCase().includes(q.replace(/\s/g, ''))
      )
      .slice(0, 8);
  }, [keys, selected, query]);

  const add = (key) => {
    onChange([...selected, key.fingerprint]);
    setQuery('');
    setHighlight(0);
    inputRef.current?.focus();
  };

  const remove = (fp) => {
    onChange(selected.filter((x) => x !== fp));
    inputRef.current?.focus();
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && options[highlight]) {
        e.preventDefault();
        add(options[highlight]);
      }
    } else if (e.key === 'Backspace' && query === '' && selected.length > 0) {
      remove(selected[selected.length - 1]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div
      className="token-box"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
          inputRef.current?.focus();
        }
      }}
    >
      {selectedKeys.map((key) => (
        <span key={key.fingerprint} className="pill" title={key.userIDs[0]}>
          <span className="pill-avatar" style={{ background: `hsl(${avatarHue(key.fingerprint)} 55% 45%)` }}>
            {initials(key.userIDs[0])}
          </span>
          {keyLabel(key)}
          {key.isPrivate && <span className="pill-me">me</span>}
          <button className="pill-x" onClick={() => remove(key.fingerprint)} title="Remove">
            ×
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        value={query}
        placeholder={selected.length === 0 ? 'Type a name, email, or fingerprint…' : ''}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setHighlight(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
        autoComplete="off"
        spellCheck={false}
      />
      {open && options.length > 0 && (
        <div className="dropdown">
          {options.map((key, i) => {
            const name = keyLabel(key);
            const { email } = parseUserID(key.userIDs[0]);
            return (
              <button
                key={key.fingerprint}
                className={'dropdown-item' + (i === highlight ? ' highlighted' : '')}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => add(key)}
              >
                <span className="pill-avatar" style={{ background: `hsl(${avatarHue(key.fingerprint)} 55% 45%)` }}>
                  {initials(key.userIDs[0])}
                </span>
                <span className="dd-name">
                  {name}
                  {key.isPrivate && <span className="pill-me">me</span>}
                </span>
                <span className="dd-email">{email}</span>
              </button>
            );
          })}
        </div>
      )}
      {open && options.length === 0 && keys.length > 0 && query && (
        <div className="dropdown">
          <div className="dropdown-empty">No keys match “{query}”</div>
        </div>
      )}
    </div>
  );
}
