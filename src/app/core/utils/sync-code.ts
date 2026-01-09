const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateSyncCode(len = 4): string {
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += ALPH[arr[i] % ALPH.length];
  }
  return out;
}
