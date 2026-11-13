import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { digest } from '../server/core.mjs';

test('independent exported-report verifier detects tampering', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'curve-evidence-'));
  try {
    const file = join(dir, 'evidence.json');
    const payload = { schemaVersion: 'curve-evidence/1', metrics: { apiRequests: 10 }, limitations: ['Synthetic test'] };
    const report = { ...payload, digest: digest(payload) };
    await writeFile(file, JSON.stringify(report));
    const verify = () => spawnSync(process.execPath, [resolve('scripts/verify-evidence.mjs'), file], { encoding: 'utf8' });
    assert.equal(verify().status, 0);
    report.metrics.apiRequests = 999;
    await writeFile(file, JSON.stringify(report));
    assert.equal(verify().status, 1);
  } finally {
    // Exact, freshly created temporary directory, not a user-derived path.
    await rm(dir, { recursive: true, force: true });
  }
});
