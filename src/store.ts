import { del, get, set } from 'idb-keyval';
import type { DavConfig } from './dav';

// --- settings (per device) ---------------------------------------------------
// Prototype: credentials live in localStorage on this device only. PIN-based
// encryption is tracked in #25.

const SETTINGS_KEY = 'makora:dav';
const LAST_FILE_KEY = 'makora:lastFile';
const OPEN_DIRS_KEY = 'makora:openDirs';

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

export function loadConfig(): DavConfig | null {
  const raw = safeGet(SETTINGS_KEY);
  if (!raw) return null;
  try {
    const c = JSON.parse(raw);
    return c.url && c.username ? c : null;
  } catch {
    return null;
  }
}
export function saveConfig(cfg: DavConfig | null) {
  safeSet(SETTINGS_KEY, cfg ? JSON.stringify(cfg) : null);
}

export const lastFile = {
  get: () => safeGet(LAST_FILE_KEY),
  set: (p: string | null) => safeSet(LAST_FILE_KEY, p),
};

// Expanded folders, remembered per server so switching servers starts clean.
export const openDirs = {
  key: (cfg: DavConfig) => `${OPEN_DIRS_KEY}:${cfg.url}|${cfg.username}`,
  get: (cfg: DavConfig): string[] => {
    try {
      return JSON.parse(safeGet(openDirs.key(cfg)) || '[]');
    } catch {
      return [];
    }
  },
  set: (cfg: DavConfig, dirs: string[]) => {
    safeSet(openDirs.key(cfg), JSON.stringify(dirs));
    safeSet(OPEN_DIRS_KEY, null); // drop the old unscoped key
  },
};

// --- drafts ------------------------------------------------------------------
// Unsaved edits are kept in IndexedDB until the server confirms a save, so a
// crash, reload or dropped connection never loses work.

export type Draft = {
  text: string;
  baseEtag: string | null; // the server version the draft was based on
  updatedAt: number;
};

function draftKey(cfg: DavConfig, path: string) {
  return `draft:${cfg.url}|${cfg.username}|${path}`;
}

export async function getDraft(cfg: DavConfig, path: string): Promise<Draft | undefined> {
  try {
    return await get<Draft>(draftKey(cfg, path));
  } catch {
    return undefined;
  }
}
export async function putDraft(cfg: DavConfig, path: string, draft: Draft) {
  try {
    await set(draftKey(cfg, path), draft);
  } catch {
    /* ignore */
  }
}
export async function clearDraft(cfg: DavConfig, path: string) {
  try {
    await del(draftKey(cfg, path));
  } catch {
    /* ignore */
  }
}

// --- preferences (per device) -------------------------------------------------
export const prefs = {
  basePath: (cfg: DavConfig): string => safeGet(`makora:basePath:${cfg.url}|${cfg.username}`) || '/',
  setBasePath: (cfg: DavConfig, p: string) => safeSet(`makora:basePath:${cfg.url}|${cfg.username}`, p),
  rememberLastFile: (): boolean => safeGet('makora:rememberLastFile') !== 'false',
  setRememberLastFile: (v: boolean) => safeSet('makora:rememberLastFile', String(v)),
};
