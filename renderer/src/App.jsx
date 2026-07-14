import React, { useCallback, useEffect, useRef, useState } from 'react';
import { call, isDemo, onUpdateState } from './api.js';
import KeyDetailModal from './components/KeyDetailModal.jsx';
import Sidebar from './components/Sidebar.jsx';
import EncryptView from './components/EncryptView.jsx';
import DecryptView from './components/DecryptView.jsx';
import KeysView from './components/KeysView.jsx';
import Toasts from './components/Toasts.jsx';
import {
  PassphraseModal,
  ConfirmModal,
  GenerateModal,
  PasteModal,
  ExportModal,
  ExportAllModal,
} from './components/Modals.jsx';

let toastSeq = 0;

export default function App() {
  const [view, setView] = useState('encrypt');
  const [keys, setKeys] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [dragging, setDragging] = useState(false);

  // Modal state
  const [passReq, setPassReq] = useState(null); // { userID, error, resolve }
  const [confirmReq, setConfirmReq] = useState(null); // { title, body, confirmLabel, danger, resolve }
  const [genOpen, setGenOpen] = useState(false);
  const [pasteReq, setPasteReq] = useState(null); // { text }
  const [exportReq, setExportReq] = useState(null); // { key, includePrivate, armored }
  const [exportAllOpen, setExportAllOpen] = useState(false);
  const [detailFpr, setDetailFpr] = useState(null); // fingerprint of key shown in detail modal

  // App version + auto-update status (packaged builds only)
  const [appInfo, setAppInfo] = useState(null);
  const [updateState, setUpdateState] = useState(null);

  const toast = useCallback((message, type = 'info') => {
    const id = ++toastSeq;
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const refreshKeys = useCallback(async () => {
    try {
      setKeys(await call('listKeys'));
    } catch (err) {
      toast(err.message, 'error');
    }
  }, [toast]);

  useEffect(() => {
    refreshKeys();
  }, [refreshKeys]);

  useEffect(() => {
    call('appInfo')
      .then((info) => {
        setAppInfo(info);
        setUpdateState(info.updateState);
      })
      .catch(() => {});
    return onUpdateState(setUpdateState);
  }, []);

  // One toast when an update finishes downloading; installing stays a
  // user-initiated action (the button in the sidebar).
  const announcedUpdate = useRef(null);
  useEffect(() => {
    if (updateState?.status === 'ready' && announcedUpdate.current !== updateState.version) {
      announcedUpdate.current = updateState.version;
      toast(`Update v${updateState.version} downloaded — restart to install`, 'success');
    }
  }, [updateState, toast]);

  const checkForUpdates = useCallback(async () => {
    try {
      await call('checkForUpdates');
    } catch (err) {
      toast(err.message, 'error');
    }
  }, [toast]);

  const installUpdate = useCallback(async () => {
    try {
      await call('installUpdate');
    } catch (err) {
      toast(err.message, 'error');
    }
  }, [toast]);

  // ---- promise-based prompts ----------------------------------------------

  const askPassphrase = useCallback(
    ({ userID, error }) =>
      new Promise((resolve) => setPassReq({ userID, error, resolve })),
    []
  );

  const confirm = useCallback(
    (opts) => new Promise((resolve) => setConfirmReq({ ...opts, resolve })),
    []
  );

  // Runs an operation that may need a private-key passphrase. When the main
  // process reports PASSPHRASE_REQUIRED / BAD_PASSPHRASE, prompts the user
  // for the named key and retries. Returns null if the user cancels.
  const runWithPassphrase = useCallback(
    async (fn) => {
      let passphrase = null;
      let fingerprint = null;
      let error = null;
      for (;;) {
        try {
          return await fn({ passphrase, fingerprint });
        } catch (err) {
          if (err.code === 'PASSPHRASE_REQUIRED' || err.code === 'BAD_PASSPHRASE') {
            error = err.code === 'BAD_PASSPHRASE' ? 'Incorrect passphrase — try again.' : null;
            const answer = await askPassphrase({
              userID: err.meta?.userID || 'private key',
              error,
            });
            if (answer === null) return null; // user cancelled
            passphrase = answer;
            fingerprint = err.meta?.fingerprint || null;
            continue;
          }
          throw err;
        }
      }
    },
    [askPassphrase]
  );

  // ---- shared actions ------------------------------------------------------

  const describeImport = (results) => {
    const counts = { added: 0, duplicate: 0, upgraded: 0, failed: 0 };
    results.forEach((r) => {
      if (r.status.startsWith('failed')) counts.failed += 1;
      else counts[r.status] += 1;
    });
    const parts = [];
    if (counts.added) parts.push(`${counts.added} key${counts.added > 1 ? 's' : ''} imported`);
    if (counts.upgraded) parts.push(`${counts.upgraded} upgraded to private`);
    if (counts.duplicate) parts.push(`${counts.duplicate} already in your keyring`);
    if (counts.failed) parts.push(`${counts.failed} failed`);
    return parts.join(' · ') || 'Nothing imported';
  };

  const importText = useCallback(
    async (text) => {
      try {
        const results = await call('importText', { armored: text });
        toast(describeImport(results), results.some((r) => r.status === 'added' || r.status === 'upgraded') ? 'success' : 'info');
        await refreshKeys();
        return true;
      } catch (err) {
        toast(err.message, 'error');
        return false;
      }
    },
    [toast, refreshKeys]
  );

  const importFromFileDialog = useCallback(async () => {
    try {
      const results = await call('importFile');
      if (results.length > 0) {
        toast(describeImport(results), 'success');
        await refreshKeys();
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  }, [toast, refreshKeys]);

  const exportKey = useCallback(
    async (key, includePrivate) => {
      if (includePrivate) {
        const ok = await confirm({
          title: 'Export private key?',
          body: `Anyone with this key (and its passphrase) can read messages encrypted to "${key.userIDs[0]}". Only export it for backups or to move it to another device.`,
          confirmLabel: 'Export private key',
          danger: true,
        });
        if (!ok) return;
      }
      try {
        const armored = await call('exportKey', {
          fingerprint: key.fingerprint,
          includePrivate,
        });
        setExportReq({ key, includePrivate, armored });
      } catch (err) {
        toast(err.message, 'error');
      }
    },
    [confirm, toast]
  );

  const deleteKey = useCallback(
    async (key) => {
      const ok = await confirm({
        title: key.isPrivate ? 'Delete private key?' : 'Delete public key?',
        body: key.isPrivate
          ? `You will permanently lose the ability to decrypt messages sent to "${key.userIDs[0]}" unless you have a backup of this key.`
          : `Remove "${key.userIDs[0]}" from your contacts? You can re-import the key later.`,
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!ok) return;
      try {
        await call('deleteKey', { fingerprint: key.fingerprint });
        toast('Key deleted', 'info');
        await refreshKeys();
      } catch (err) {
        toast(err.message, 'error');
      }
    },
    [confirm, toast, refreshKeys]
  );

  const lockSession = useCallback(async () => {
    await call('lockSession');
    await refreshKeys();
    toast('Cached passphrases forgotten', 'info');
  }, [refreshKeys, toast]);

  // ---- drag & drop key import ---------------------------------------------

  const dragDepth = useRef(0);
  useEffect(() => {
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    const onDragEnter = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    };
    const onDragOver = (e) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDragLeave = (e) => {
      if (!hasFiles(e)) return;
      dragDepth.current -= 1;
      if (dragDepth.current <= 0) {
        dragDepth.current = 0;
        setDragging(false);
      }
    };
    const onDrop = async (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      let text = '';
      for (const file of e.dataTransfer.files) {
        try {
          text += (await file.text()) + '\n';
        } catch {
          /* skip unreadable file */
        }
      }
      if (text.includes('BEGIN PGP')) {
        await importText(text);
      } else {
        toast('No PGP keys found in the dropped file(s)', 'error');
      }
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [importText, toast]);

  // ---------------------------------------------------------------------------

  // Derived from the live key list so the detail modal closes itself when the
  // key is deleted (and reflects unlock-status changes immediately).
  const detailKey = detailFpr ? keys.find((k) => k.fingerprint === detailFpr) : null;

  return (
    <div id="app">
      <Sidebar
        view={view}
        onNavigate={setView}
        keys={keys}
        onLock={lockSession}
        isDemo={isDemo}
        appInfo={appInfo}
        updateState={updateState}
        onCheckUpdates={checkForUpdates}
        onInstallUpdate={installUpdate}
      />
      <main id="main">
        <EncryptView
          active={view === 'encrypt'}
          keys={keys}
          runWithPassphrase={runWithPassphrase}
          toast={toast}
          onKeysChanged={refreshKeys}
        />
        <DecryptView
          active={view === 'decrypt'}
          keys={keys}
          runWithPassphrase={runWithPassphrase}
          toast={toast}
          onImportKey={importText}
          onKeysChanged={refreshKeys}
        />
        <KeysView
          active={view === 'keys'}
          keys={keys}
          toast={toast}
          onGenerate={() => setGenOpen(true)}
          onImportFile={importFromFileDialog}
          onImportPaste={() => setPasteReq({ text: '' })}
          onExport={exportKey}
          onDelete={deleteKey}
          onExportAll={() => setExportAllOpen(true)}
          onDetails={(key) => setDetailFpr(key.fingerprint)}
        />
      </main>

      {passReq && (
        <PassphraseModal
          userID={passReq.userID}
          error={passReq.error}
          onSubmit={(value) => {
            passReq.resolve(value);
            setPassReq(null);
          }}
          onCancel={() => {
            passReq.resolve(null);
            setPassReq(null);
          }}
        />
      )}
      {confirmReq && (
        <ConfirmModal
          {...confirmReq}
          onResult={(ok) => {
            confirmReq.resolve(ok);
            setConfirmReq(null);
          }}
        />
      )}
      {genOpen && (
        <GenerateModal
          onClose={() => setGenOpen(false)}
          onDone={async (label) => {
            setGenOpen(false);
            toast(`${label} generated`, 'success');
            await refreshKeys();
          }}
        />
      )}
      {pasteReq && (
        <PasteModal
          initialText={pasteReq.text}
          onClose={() => setPasteReq(null)}
          onImport={async (text) => {
            const ok = await importText(text);
            if (ok) setPasteReq(null);
          }}
        />
      )}
      {exportAllOpen && (
        <ExportAllModal keys={keys} toast={toast} onClose={() => setExportAllOpen(false)} />
      )}
      {detailKey && (
        <KeyDetailModal
          keyData={detailKey}
          toast={toast}
          onExport={exportKey}
          onDelete={deleteKey}
          onClose={() => setDetailFpr(null)}
        />
      )}
      {exportReq && (
        <ExportModal
          exportReq={exportReq}
          toast={toast}
          onClose={() => setExportReq(null)}
        />
      )}

      {dragging && (
        <div id="drop-overlay">
          <div className="drop-inner">Drop key files to import</div>
        </div>
      )}

      <Toasts toasts={toasts} />
    </div>
  );
}
