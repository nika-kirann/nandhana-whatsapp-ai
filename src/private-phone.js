import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
export function validatePhone(value) {
  const normalized = value.trim();
  if (!/^[1-9]\d{7,14}$/.test(normalized)) throw new Error('Invalid private phone input');
  return normalized;
}
export async function readPrivatePhone(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > 32 || (info.mode & 0o777) !== 0o600 || (process.getuid && info.uid !== process.getuid())) throw new Error('Unsafe private phone file');
    return validatePhone(await file.readFile('utf8'));
  } finally { await file.close(); }
}
