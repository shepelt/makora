import React, { useState, useEffect } from 'react';
import { Meteor } from 'meteor/meteor';

export function Settings({ onSaved, isModal = false }) {
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [basePath, setBasePath] = useState('/');
  const [hasPassword, setHasPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  // Directory picker state
  const [showDirPicker, setShowDirPicker] = useState(false);
  const [browsingPath, setBrowsingPath] = useState('/');
  const [directories, setDirectories] = useState([]);
  const [loadingDirs, setLoadingDirs] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const settings = await Meteor.callAsync('settings.getWebdav');
      if (settings) {
        setUrl(settings.url || '');
        setUsername(settings.username || '');
        setBasePath(settings.basePath || '/');
        setHasPassword(settings.hasPassword || false);
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadDirectories = async (path) => {
    setLoadingDirs(true);
    try {
      const result = await Meteor.callAsync('settings.listDirectories', { url, username, password, path });
      setDirectories(result.directories || []);
    } catch (err) {
      setError(err.reason || err.message);
    } finally {
      setLoadingDirs(false);
    }
  };

  const handleTest = async () => {
    setError('');
    setSuccess('');
    setTesting(true);
    // Show directory picker immediately with loading state
    setShowDirPicker(true);
    setBrowsingPath(basePath);
    setLoadingDirs(true);
    setDirectories([]);

    try {
      await Meteor.callAsync('settings.testWebdav', { url, username, password });
      await loadDirectories(basePath);
    } catch (err) {
      setError(err.reason || err.message);
      setShowDirPicker(false);
      setLoadingDirs(false);
    } finally {
      setTesting(false);
    }
  };

  const handleNavigate = async (dirName) => {
    const newPath = browsingPath === '/' ? `/${dirName}` : `${browsingPath}/${dirName}`;
    setBrowsingPath(newPath);
    await loadDirectories(newPath);
  };

  const handleNavigateUp = async () => {
    if (browsingPath === '/') return;
    const parts = browsingPath.split('/').filter(Boolean);
    parts.pop();
    const newPath = '/' + parts.join('/');
    setBrowsingPath(newPath || '/');
    await loadDirectories(newPath || '/');
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSaving(true);

    try {
      await Meteor.callAsync('settings.saveWebdav', { url, username, password, basePath });
      if (onSaved) {
        onSaved();
      }
    } catch (err) {
      setError(err.reason || err.message);
    } finally {
      setSaving(false);
    }
  };

  // Only show loading screen for standalone mode (not modal)
  if (loading && !isModal) {
    return (
      <div className="min-h-dvh bg-ivory flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 py-12">
          <div className="w-6 h-6 border-2 border-cream border-t-charcoal rounded-full animate-spin" />
          <span className="text-warm-gray text-sm">Loading...</span>
        </div>
      </div>
    );
  }

  const cardContent = (
    <>
      {/* Card */}
      <div className="bg-ivory rounded-2xl border border-cream p-8 shadow-lg">
        {/* Sign out link - only show when not modal */}
        {!isModal && (
          <div className="flex justify-end mb-6">
            <button
              type="button"
              onClick={() => Meteor.logout()}
              className="text-sm text-terracotta hover:text-terracotta/80"
            >
              Sign out
            </button>
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-5">
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-charcoal mb-2">
              WebDAV URL
              {loading && (
                <div className="w-3 h-3 border border-warm-gray/30 border-t-charcoal rounded-full animate-spin" />
              )}
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://cloud.example.com/remote.php/dav/files/you"
              className="w-full px-4 py-3 bg-white border border-cream rounded-xl text-charcoal placeholder-warm-gray/50 text-sm"
              required
            />
            <p className="mt-2 text-xs text-warm-gray/70">
              Nextcloud: https://your-server/remote.php/dav/files/username
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-charcoal mb-2">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="your-username"
              className="w-full px-4 py-3 bg-white border border-cream rounded-xl text-charcoal placeholder-warm-gray/50 text-sm"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-charcoal mb-2">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full px-4 py-3 bg-white border border-cream rounded-xl text-charcoal placeholder-warm-gray/50 text-sm"
              required={!hasPassword}
            />
            <p className="mt-2 text-xs text-warm-gray/70">
              For Nextcloud, create an app password in Settings → Security
            </p>
          </div>

          {/* Status messages */}
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

          {/* Directory Picker */}
          {showDirPicker && (
            <div className="border border-cream rounded-xl overflow-hidden">
              {/* Current path header */}
              <div className="flex items-center gap-2 px-3 py-2 bg-cream/50 border-b border-cream">
                <button
                  type="button"
                  onClick={handleNavigateUp}
                  disabled={browsingPath === '/' || loadingDirs}
                  className="p-1 rounded hover:bg-white/50 disabled:opacity-30"
                >
                  <svg className="w-4 h-4 text-charcoal" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <span className="text-sm text-charcoal truncate flex-1">{browsingPath}</span>
              </div>
              {/* Directory list */}
              <div className="h-40 overflow-y-auto bg-white">
                {/* Option for current directory */}
                {!loadingDirs && (
                  <div className="flex items-center px-3 py-2 bg-cream/20 border-b border-cream">
                    <input
                      type="radio"
                      name="selectedDir"
                      checked={basePath === browsingPath}
                      onChange={() => setBasePath(browsingPath)}
                      className="w-4 h-4 mr-2 accent-charcoal"
                    />
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
                    const fullPath = browsingPath === '/' ? `/${dir}` : `${browsingPath}/${dir}`;
                    const isSelected = basePath === fullPath;
                    return (
                      <div key={dir} className="flex items-center px-3 py-2 hover:bg-cream/30">
                        <input
                          type="radio"
                          name="selectedDir"
                          checked={isSelected}
                          onChange={() => setBasePath(fullPath)}
                          className="w-4 h-4 mr-2 accent-charcoal"
                        />
                        <button
                          type="button"
                          onClick={() => handleNavigate(dir)}
                          className="flex-1 flex items-center gap-2 text-sm text-charcoal text-left"
                        >
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
              {/* Selected path display */}
              <div className="px-3 py-2 bg-cream/30 border-t border-cream">
                <p className="text-xs text-warm-gray">
                  Selected: <span className="text-charcoal font-medium">{basePath}</span>
                </p>
              </div>
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-3 pt-3">
            <button
              type="button"
              onClick={handleTest}
              disabled={testing || !url || !username || (!password && !hasPassword)}
              className="flex-1 px-4 py-3 text-sm font-medium text-charcoal bg-white border border-cream rounded-xl hover:border-warm-gray/30 disabled:opacity-100 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {testing && (
                <div className="w-4 h-4 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />
              )}
              Test Connection
            </button>
            <button
              type="submit"
              disabled={saving || !url || !username || (!password && !hasPassword)}
              className="flex-1 px-4 py-3 text-sm font-medium text-white bg-terracotta rounded-xl hover:bg-terracotta-dark disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Save & Continue
            </button>
          </div>
        </form>
      </div>

      {/* Footer */}
      <p className="text-center mt-8 text-warm-gray/70 text-xs">
        Your credentials are stored securely and never shared.
      </p>
    </>
  );

  // Modal mode: just return the card content
  if (isModal) {
    return cardContent;
  }

  // Standalone mode: wrap in full-screen layout
  return (
    <div className="min-h-dvh bg-ivory flex items-center justify-center relative overflow-hidden">
      {/* Subtle paper texture overlay */}
      <div className="absolute inset-0 paper-texture pointer-events-none" />

      <div className="relative z-10 w-full max-w-sm mx-6">
        {/* Logo and title */}
        <div className="text-center mb-12">
          <h1 className="font-serif text-5xl font-light text-charcoal tracking-tight mb-3">
            Makora
          </h1>
          <p className="text-warm-gray text-sm tracking-wide">
            WebDAV Configuration
          </p>
        </div>

        {cardContent}
      </div>
    </div>
  );
}
