import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.mjs';

test('project and telemetry survive reopening the PostgreSQL store', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'curve-persistence-'));
  const dataDir = join(folder, 'postgres');
  let service;
  try {
    service = await createApp({dataDir, seed:false});
    await service.db.query(
      "INSERT INTO projects(id,name,domain,network,owner_id) VALUES ($1,$2,$3,$4,$5)",
      ['persistence-check','Persistence check','test.example','testnet','demo-tenant']);
    await service.db.query('INSERT INTO records(id,project_id,ts,data) VALUES ($1,$2,now(),$3)',
      ['point','persistence-check', JSON.stringify({type:'api',count:10})]);
    await service.close();
    service = undefined;
    service = await createApp({dataDir, seed:false});
    const { rows } = await service.db.query('SELECT projects.name, records.data FROM projects JOIN records ON records.project_id=projects.id');
    assert.deepEqual(rows, [{name:'Persistence check',data:{type:'api',count:10}}]);
  } finally {
    await service?.close();
    // PGlite owns this fresh test database beneath the system temp directory.
    const { rm } = await import('node:fs/promises');
    await rm(dataDir,{recursive:true,force:true});
    await rmdir(folder);
  }
});
