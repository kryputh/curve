import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import protobuf from 'protobufjs';
import { createApp } from '../server/app.mjs';

test('gzip OTLP/HTTP protobuf reaches reporting with a protobuf response', async () => {
  const protoDir = fileURLToPath(new URL('../server/proto/',import.meta.url));
  const schema = new protobuf.Root();
  schema.resolvePath = (_,name) => resolve(protoDir,name);
  schema.loadSync('opentelemetry/proto/collector/metrics/v1/metrics_service.proto');
  const requestType = schema.lookupType('opentelemetry.proto.collector.metrics.v1.ExportMetricsServiceRequest');
  const responseType = schema.lookupType('opentelemetry.proto.collector.metrics.v1.ExportMetricsServiceResponse');
  const service = await createApp({seed:false});
  const server = service.app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = {'Content-Type':'application/json'};
  try {
    const login = await fetch(base+'/api/auth/demo',{method:'POST',headers:json,body:JSON.stringify({role:'tenant'})});
    const Cookie = login.headers.get('set-cookie').split(';')[0];
    const projectResponse = await fetch(base+'/api/projects',{
      method:'POST',headers:{...json,Cookie},body:JSON.stringify({name:'Binary ingest',domain:'binary.example'}),
    });
    const {project,apiKey} = await projectResponse.json();
    const point = {
      timeUnixNano:String(BigInt(Date.now())*1_000_000n),
      count:'4', sum:0.5, explicitBounds:[0.25], bucketCounts:['4','0'],
      attributes:[
        {key:'http.route',value:{stringValue:'/payouts/742'}},
        {key:'http.response.status_code',value:{intValue:'201'}},
      ],
    };
    const request = requestType.fromObject({resourceMetrics:[{scopeMetrics:[{metrics:[
      {name:'http.server.request.duration',unit:'s',histogram:{aggregationTemporality:1,dataPoints:[point]}},
      {name:'process.cpu.utilization',gauge:{dataPoints:[{asDouble:0.5}]}},
    ]}]}]});
    const body = gzipSync(requestType.encode(request).finish());
    const response = await fetch(base+'/api/otlp/v1/metrics',{
      method:'POST',body,headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/x-protobuf','Content-Encoding':'gzip'},
    });
    assert.equal(response.status,200);
    assert.match(response.headers.get('content-type'),/^application\/x-protobuf/);
    const decoded = responseType.decode(new Uint8Array(await response.arrayBuffer()));
    assert.equal(String(decoded.partialSuccess.rejectedDataPoints),'1');
    const report = await (await fetch(base+`/api/projects/${project.id}/overview`,{headers:{Cookie}})).json();
    assert.equal(report.metrics.apiRequests,4);
    assert.deepEqual(report.statusCodes,[{status:201,count:4}]);
    assert.equal(report.endpoints[0].path,'/payouts/:id');
    const malformed = await fetch(base+'/api/otlp/v1/metrics',{
      method:'POST',body:Buffer.from([10,255]),headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/x-protobuf'},
    });
    assert.equal(malformed.status,400);
  } finally {
    await new Promise(resolve=>server.close(resolve));
    await service.close();
  }
});
