const KEY_PREFIX = 'pxgDaily:DB:';
const ACTIVE_KEY = 'pxgDaily:ACTIVE_USER';

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

function normalizeName(name: string): string {
  return name.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizeKey(name: string, code: string): string {
  const n = normalizeName(name);
  const c = normalizeCode(code);
  return `${n}::${c}`;
}

export interface ActiveUser {
  name: string;
  syncCode: string;
}

export function setActiveUser(name: string, syncCode: string) {
  if (!isBrowser()) return;

  localStorage.setItem(
    ACTIVE_KEY,
    JSON.stringify({ name, syncCode } satisfies ActiveUser)
  );
}

export function getActiveUser(): ActiveUser | null {
  if (!isBrowser()) return null;

  const raw = localStorage.getItem(ACTIVE_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function clearActiveUser() {
  if (!isBrowser()) return;
  localStorage.removeItem(ACTIVE_KEY);
}

export function saveDb(name: string, syncCode: string, db: any) {
  if (!isBrowser()) return;

  const key = normalizeKey(name, syncCode);
  localStorage.setItem(KEY_PREFIX + key, JSON.stringify(db));
}

export function loadDb(name: string, syncCode: string) {
  if (!isBrowser()) return null;

  const key = normalizeKey(name, syncCode);
  const raw = localStorage.getItem(KEY_PREFIX + key);
  return raw ? JSON.parse(raw) : null;
}

export function findLatestDbByName(name: string): { syncCode: string; db: any } | null {
  if (!isBrowser()) return null;

  const n = normalizeName(name);
  if (!n) return null;

  const prefix = KEY_PREFIX + n + '::';

  const matches: Array<{ key: string; code: string; db: any; updatedAt: string }> = [];

  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    if (!k.startsWith(prefix)) continue;

    const code = k.substring(prefix.length);
    const raw = localStorage.getItem(k);
    if (!raw) continue;

    try {
      const db = JSON.parse(raw);
      const updatedAt = String(db?.meta?.updatedAt ?? '');
      matches.push({ key: k, code, db, updatedAt });
    } catch {
    }
  }

  if (matches.length === 0) return null;

  matches.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  return { syncCode: matches[0].code, db: matches[0].db };
}

export interface RecentAccess {
  name: string;
  syncCode: string;
  lastOpenAt?: string;
  updatedAt?: string;
  createdAt?: string;
}

function safeParseJson(raw: string): any | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function listRecentAccesses(limit = 8): RecentAccess[] {
  if (!isBrowser()) return [];

  const out: RecentAccess[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(KEY_PREFIX)) continue;

    const raw = localStorage.getItem(k);
    if (!raw) continue;

    const db = safeParseJson(raw);
    if (!db?.profile?.displayName) continue;

    const keyTail = k.substring(KEY_PREFIX.length);
    const parts = keyTail.split('::');
    if (parts.length !== 2) continue;

    const syncCode = parts[1];

    out.push({
      name: String(db.profile.displayName),
      syncCode,
      lastOpenAt: db.profile.lastOpenAt,
      createdAt: db.profile.createdAt,
      updatedAt: db.meta?.updatedAt,
    });
  }

  const byName = new Map<string, RecentAccess>();
  for (const item of out) {
    const key = item.name.trim().toLowerCase();
    const current = byName.get(key);
    if (!current) {
      byName.set(key, item);
      continue;
    }

    const a = mostRecentIso(item);
    const b = mostRecentIso(current);
    if (a > b) byName.set(key, item);
  }

  const unique = Array.from(byName.values());

  unique.sort((a, b) => mostRecentIso(b).localeCompare(mostRecentIso(a)));

  return unique.slice(0, Math.max(0, limit));
}

function mostRecentIso(x: RecentAccess): string {
  return (
    x.lastOpenAt ??
    x.updatedAt ??
    x.createdAt ??
    '1970-01-01T00:00:00.000Z'
  );
}

export function removeDb(name: string, syncCode: string): void {
  if (!isBrowser()) return;
  const key = normalizeKey(name, syncCode);
  localStorage.removeItem(KEY_PREFIX + key);
}
