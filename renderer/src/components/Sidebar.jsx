import React from 'react';

const LockIcon = ({ open, size = 17 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" />
    {open ? <path d="M7 11V7a5 5 0 0 1 9.9-1" /> : <path d="M7 11V7a5 5 0 0 1 10 0v4" />}
  </svg>
);

const KeyIcon = ({ size = 17 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m21 2-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8Zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
  </svg>
);

export default function Sidebar({ view, onNavigate, keys, onLock, isDemo }) {
  const unlockedCount = keys.filter((k) => k.isPrivate && k.unlocked).length;

  const items = [
    { id: 'encrypt', label: 'Encrypt', icon: <LockIcon /> },
    { id: 'decrypt', label: 'Decrypt', icon: <LockIcon open /> },
    { id: 'keys', label: 'Keys', icon: <KeyIcon />, count: keys.length || null },
  ];

  return (
    <aside id="sidebar">
      <div className="brand">
        <LockIcon size={22} />
        <span>PGP Tool</span>
        {isDemo && <span className="demo-badge" title="Running in a browser — crypto is mocked. Launch the desktop app for the real thing.">DEMO</span>}
      </div>
      <nav>
        {items.map((item) => (
          <button
            key={item.id}
            className={'nav-item' + (view === item.id ? ' active' : '')}
            onClick={() => onNavigate(item.id)}
          >
            {item.icon}
            <span>{item.label}</span>
            {item.count != null && <span className="count">{item.count}</span>}
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        {unlockedCount > 0 && (
          <button className="nav-item" onClick={onLock} title="Forget cached passphrases now">
            <LockIcon />
            <span>Lock keys</span>
            <span className="count green">{unlockedCount}</span>
          </button>
        )}
        <div className="unlock-status">
          {unlockedCount > 0
            ? `${unlockedCount} key${unlockedCount > 1 ? 's' : ''} unlocked`
            : 'All keys locked'}
        </div>
      </div>
    </aside>
  );
}
