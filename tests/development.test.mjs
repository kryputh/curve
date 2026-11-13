import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server/app.mjs';

test('development opens empty with operator access and no account or demo login', async()=>{
  const service=await createApp({mode:'development'});
  const server=service.app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    const projects=await fetch(base+'/api/projects');
    assert.equal(projects.status,200);
    assert.equal(projects.headers.get('set-cookie'),null);
    assert.deepEqual((await projects.json()).projects,[]);
    const created=await fetch(base+'/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Development app',domain:'dev.example'})});
    assert.equal(created.status,201);
    const {project}=await created.json();
    assert.equal(project.isDemo,false);
    assert.equal((await fetch(base+`/api/projects/${project.id}/overview`)).status,200);
    assert.equal((await fetch(base+'/api/operator/read-keys',{method:'POST'})).status,201);
    for(const route of ['login','register','demo']) assert.equal((await fetch(base+'/api/auth/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,404);
    assert.equal((await fetch(base+'/api/projects',{headers:{Origin:'https://unrelated.example'}})).status,403);
    assert.equal((await fetch(base+`/api/projects/${project.id}`,{method:'DELETE'})).status,200);
  } finally {
    await new Promise(resolve=>server.close(resolve));
    await service.close();
  }
});
