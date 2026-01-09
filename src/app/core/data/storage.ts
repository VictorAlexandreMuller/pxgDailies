const KEY_PREFIX = 'pxgDaily:DB:';
const ACTIVE_KEY = 'pxgDaily:ACTIVE_USER';

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

function normalizeKey(name: string, code: string): string {
  const n = name.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const c = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
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
