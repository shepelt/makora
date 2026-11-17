import { useState } from 'react';
import { testConnection } from './dav';
import type { DavConfig } from './dav';

type Props = {
  initial: DavConfig | null;
  onSave: (cfg: DavConfig) => void;
  onCancel?: () => void;
  onForget?: () => void;
};

export function Settings({ initial, onSave, onCancel, onForget }: Props) {
  const [url, setUrl] = useState(initial?.url ?? '');
  const [username, setUsername] = useState(initial?.username ?? '');
  const [password, setPassword] = useState('');
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const insecure = /^http:\/\//i.test(url.trim());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cfg: DavConfig = {
      url: url.trim().replace(/\/+$/, ''),
      username: username.trim(),
      password: password || initial?.password || '',
    };
    if (!cfg.url || !cfg.username || !cfg.password) {
      setError('URL, username and password are required.');
      return;
    }
    setTesting(true);
    setError(null);
    try {
      await testConnection(cfg);
      onSave(cfg);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-stone-900/20 p-4 backdrop-blur-[2px]">
      <form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-xl ring-1 ring-stone-200">
        <div>
          <h2 className="text-lg font-semibold text-stone-800">WebDAV connection</h2>
          <p className="mt-1 text-sm text-stone-500">
            Stored only on this device. For Nextcloud, use an <em>app password</em> (Settings → Security), not your login password.
          </p>
        </div>
        <label className="block space-y-1">
          <span className="text-sm text-stone-600">WebDAV URL</span>
          <input
            className="w-full rounded-lg border border-stone-300 px-3 py-2 text-[15px] outline-none focus:border-stone-500"
            placeholder="https://cloud.example.com/remote.php/dav/files/you"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            inputMode="url"
          />
        </label>
        {insecure && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            This server uses plain http: your password and notes travel unencrypted between Makora and the server. Prefer an https URL.
          </p>
        )}
        <label className="block space-y-1">
          <span className="text-sm text-stone-600">Username</span>
          <input
            className="w-full rounded-lg border border-stone-300 px-3 py-2 text-[15px] outline-none focus:border-stone-500"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="username"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-stone-600">Password</span>
          <input
            type="password"
            className="w-full rounded-lg border border-stone-300 px-3 py-2 text-[15px] outline-none focus:border-stone-500"
            placeholder={initial?.password ? '•••••••• (unchanged)' : ''}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex items-center gap-2 pt-1">
          {onForget && initial && (
            <button type="button" className="text-sm text-stone-500 hover:text-red-700" onClick={onForget}>
              Forget
            </button>
          )}
          <span className="ml-auto" />
          {onCancel && (
            <button type="button" className="rounded-lg px-4 py-2 text-sm text-stone-600 hover:bg-stone-100" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button disabled={testing} className="rounded-lg bg-stone-800 px-4 py-2 text-sm text-white disabled:opacity-60">
            {testing ? 'Connecting…' : 'Connect'}
          </button>
        </div>
      </form>
    </div>
  );
}
