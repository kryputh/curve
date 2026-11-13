import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Independent verifier: no database or server code required.
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}
if (!process.argv[2]) {
  console.error('Usage: node scripts/verify-evidence.mjs path/to/evidence.json');
  process.exitCode = 2;
} else {
  const report = JSON.parse(await readFile(process.argv[2], 'utf8'));
  const { digest, ...payload } = report;
  const expected = createHash('sha256').update(canonical(payload)).digest('hex');
  const supplied = typeof digest === 'string' ? digest.replace(/^sha256:/, '') : digest?.value;
  if (supplied !== expected) {
    console.error('FAIL: report contents do not match its SHA-256 digest.');
    process.exitCode = 1;
  } else {
    console.log('PASS: report integrity verified.');
    console.log('This checks consistency only. It does not authenticate the publisher or prove genuine human usage.');
  }
}
