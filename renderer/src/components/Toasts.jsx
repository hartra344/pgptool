import React from 'react';

export default function Toasts({ toasts }) {
  return (
    <div id="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={'toast ' + t.type}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
