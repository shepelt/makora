// Settings. Visuals ported from the Meteor version (main: Settings.jsx).
// Credentials stay on this device (no server-side storage).
import { useState } from 'react';
import { list, testConnection } from './dav';
import type { DavConfig } from './dav';
import { prefs } from './store';

type Props = {
  initial: DavConfig | null;
  isModal: boolean;
  onSaved: (cfg: DavConfig) => void;
  onClose?: () => void;
  onDisconnect?: () => void;
};

function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <div className="flex items-center justify-between py-3">
      <div>
        <label className="text-sm font-medium text-charcoal">{label}</label>
        {description && <p className="text-xs text-warm-gray/70 mt-0.5">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${checked ? 'bg-terracotta' : 'bg-gray-300'}`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </div>
  );
}

export function Settings({ initial, isModal, onSaved, onClose, onDisconnect }: Props) {
  const [url, setUrl] = useState(initial?.url ?? '');
  const [username, setUsername] = useState(initial?.username ?? '');
  const [password, setPassword] = useState('');
  const hasPassword = !!initial?.password;
  const [basePath, setBasePath] = useState(() => (initial ? prefs.basePath(initial) : '/'));
  const [rememberLastFile, setRememberLastFile] = useState(prefs.rememberLastFile());
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showDirPicker, setShowDirPicker] = useState(false);
  const [browsingPath, setBrowsingPath] = useState('/');
  const [directories, setDirectories] = useState<string[]>([]);
  const [loadingDirs, setLoadingDirs] = useState(false);

  const draft = (): DavConfig => ({
    url: url.trim().replace(/\/+$/, ''),
    username: username.trim(),
    password: password || initial?.password || '',
  });

  const loadDirs = async (path: string) => {
    setLoadingDirs(true);
    try {
      const entries = await list(draft(), path);
      setDirectories(entries.filter((e) => e.isDir && !e.name.startsWith('.')).map((e) => e.name).sort((a, b) => a.localeCompare(b)));
      setBrowsingPath(path);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoadingDirs(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setError(null);
    setSuccess(null);
    try {
      await testConnection(draft());
      setSuccess('Connection successful! Choose a base folder below.');
      setShowDirPicker(true);
      await loadDirs(basePath && basePath !== '/' ? basePath : '/');
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const cfg = draft();
    if (!cfg.url || !cfg.username || !cfg.password) return setError('URL, username and password are required.');
    setSaving(true);
    setError(null);
    try {
      await testConnection(cfg);
      prefs.setBasePath(cfg, basePath || '/');
      prefs.setRememberLastFile(rememberLastFile);
      onSaved(cfg);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setSaving(false);
    }
  };

  const insecure = /^http:\/\//i.test(url.trim());
  const input = 'w-full px-4 py-3 bg-white border border-cream rounded-xl text-charcoal placeholder-warm-gray/50 text-sm';

  const card = (
    <>
      <div className="bg-ivory rounded-2xl border border-cream p-6 shadow-lg space-y-6 max-h-[80dvh] overflow-y-auto">
        {!isModal && initial && onDisconnect && (
          <div className="flex justify-end -mt-2 -mr-2">
            <button type="button" onClick={onDisconnect} className="text-sm text-terracotta hover:text-terracotta/80">
              Disconnect
            </button>
          </div>
        )}

        <form id="webdav-form" onSubmit={handleSave} className="space-y-4">
          <h3 className="text-xs font-medium text-warm-gray uppercase tracking-wider">WebDAV Connection</h3>
          <div>
            <label htmlFor="dav-url" className="flex items-center gap-2 text-sm font-medium text-charcoal mb-2">
              Server URL
            </label>
            <input
              id="dav-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://cloud.example.com/remote.php/dav/files/you"
              className={input}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              required
            />
            <p className="mt-1.5 text-xs text-warm-gray/70">Nextcloud: https://your-server/remote.php/dav/files/username</p>
            {insecure && (
              <p className="mt-2 px-3 py-2 text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-xl">
                This server uses plain http: your password and notes travel unencrypted. Prefer an https URL.
              </p>
            )}
          </div>
          <div>
            <label htmlFor="dav-user" className="block text-sm font-medium text-charcoal mb-2">
              Username
            </label>
            <input
              id="dav-user"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="your-username"
              className={input}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="username"
              required
            />
          </div>
          <div>
            <label htmlFor="dav-pass" className="block text-sm font-medium text-charcoal mb-2">
              Password
            </label>
            <input
              id="dav-pass"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className={input}
              autoComplete="current-password"
              required={!hasPassword}
            />
            <p className="mt-1.5 text-xs text-warm-gray/70">For Nextcloud, create an app password in Settings → Security</p>
          </div>

          <button
            type="button"
            onClick={handleTest}
            disabled={testing || !url || !username || (!password && !hasPassword)}
            className="w-full px-4 py-2.5 text-sm font-medium text-charcoal bg-white border border-cream rounded-xl hover:border-warm-gray/30 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {testing && <div className="w-4 h-4 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />}
            Test Connection
          </button>

          {error && (
            <div className="px-4 py-3 bg-red-50/80 border border-red-100 rounded-xl">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}
          {success && (
            <div className="px-4 py-3 bg-emerald-50/80 border border-emerald-100 rounded-xl">
              <p className="text-sm text-emerald-600">{success}</p>
            </div>
          )}

          {showDirPicker && (
            <div className="border border-cream rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 bg-cream/50 border-b border-cream">
                <button
                  type="button"
                  onClick={() => void loadDirs(browsingPath.slice(0, browsingPath.lastIndexOf('/')) || '/')}
                  disabled={browsingPath === '/' || loadingDirs}
                  className="p-1 rounded hover:bg-white/50 disabled:opacity-30"
                  aria-label="Up"
                >
                  <svg className="w-4 h-4 text-charcoal" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <span className="text-sm text-charcoal truncate flex-1">{browsingPath}</span>
              </div>
              <div className="h-40 overflow-y-auto bg-white">
                {!loadingDirs && (
                  <div className="flex items-center px-3 py-2 bg-cream/20 border-b border-cream">
                    <input type="radio" name="selectedDir" checked={basePath === browsingPath} onChange={() => setBasePath(browsingPath)} className="w-4 h-4 mr-2 accent-charcoal" />
                    <span className="text-sm text-charcoal font-medium">Use current: {browsingPath}</span>
                  </div>
                )}
                {loadingDirs ? (
                  <div className="h-full flex items-center justify-center gap-2">
                    <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />
                    <span className="text-sm text-warm-gray">Loading...</span>
                  </div>
                ) : directories.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-warm-gray text-center">No subdirectories</p>
                ) : (
                  directories.map((dir) => {
                    const full = browsingPath === '/' ? `/${dir}` : `${browsingPath}/${dir}`;
                    return (
                      <div key={dir} className="flex items-center px-3 py-2 hover:bg-cream/30">
                        <input type="radio" name="selectedDir" checked={basePath === full} onChange={() => setBasePath(full)} className="w-4 h-4 mr-2 accent-charcoal" />
                        <button type="button" onClick={() => void loadDirs(full)} className="flex-1 flex items-center gap-2 text-sm text-charcoal text-left">
                          <svg className="w-4 h-4 text-warm-gray" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                          </svg>
                          {dir}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
              <div className="px-3 py-2 bg-cream/30 border-t border-cream">
                <p className="text-xs text-warm-gray">
                  Selected: <span className="text-charcoal font-medium">{basePath}</span>
                </p>
              </div>
            </div>
          )}
        </form>

        <div className="border-t border-cream pt-5 space-y-1">
          <h3 className="text-xs font-medium text-warm-gray uppercase tracking-wider mb-3">Preferences</h3>
          <Toggle checked={rememberLastFile} onChange={setRememberLastFile} label="Remember last file" description="Open the last viewed file on startup" />
        </div>

        <button
          type="submit"
          form="webdav-form"
          disabled={saving || !url || !username || (!password && !hasPassword)}
          className="w-full px-4 py-3 text-sm font-medium text-white bg-terracotta rounded-xl hover:bg-terracotta-dark disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving...' : 'Save & Continue'}
        </button>

        {isModal && initial && onDisconnect && (
          <button type="button" onClick={onDisconnect} className="w-full text-sm text-warm-gray hover:text-red-600">
            Disconnect this device
          </button>
        )}
      </div>
      <p className={`text-center mt-6 text-xs ${isModal ? 'text-white/70' : 'text-warm-gray/70'}`}>Your credentials are stored only on this device.</p>
    </>
  );

  if (isModal) {
    return (
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center" style={{ transition: 'none' }}>
        <div className="relative w-full max-w-md mx-4" style={{ transition: 'none' }}>
          <button onClick={onClose} className="absolute -top-10 right-0 text-white/80 hover:text-white text-sm">
            Close
          </button>
          {card}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh h-dvh overflow-y-auto bg-ivory flex items-center justify-center relative">
      <div className="absolute inset-0 paper-texture pointer-events-none" />
      <div className="relative z-10 w-full max-w-sm mx-6 py-10">
        <div className="text-center mb-12">
          <h1 className="font-serif text-5xl font-light text-charcoal tracking-tight mb-3">Makora</h1>
          <p className="text-warm-gray text-sm tracking-wide">WebDAV Configuration</p>
        </div>
        {card}
      </div>
    </div>
  );
}
