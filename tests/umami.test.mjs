import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fetchUmami } from '../server/umami.mjs';

test('Umami adapter requests path metrics and normalizes report dimensions', async () => {
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const metric = url.searchParams.get('type');
    let result;
    if (url.pathname === '/api/auth/login' && request.method === 'POST') result = { token: 'test-token' };
    else if (request.headers.authorization !== 'Bearer test-token') response.statusCode = 401;
    else if (url.pathname.endsWith('/stats')) result = { '0': {pageviews: 10, visitors: 5, visits: 5, bounces: 1, totaltime: 120} };
    else if (url.pathname.endsWith('/pageviews')) result = {pageviews: [{x:'2026-11-13', y:10}]};
    else if (metric === 'path') result = [{x:'/accounts/123?token=private',y:4},{x:'/accounts/456',y:6}];
    else if (metric === 'referrer') result = [{x:'https://example.org/private?token=private',y:6}];
    else if (['country','device','browser'].includes(metric)) result = [];
    else response.statusCode = 400;
    response.setHeader('Content-Type','application/json');
    response.end(JSON.stringify(result ?? {}));
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const saved = process.env.UMAMI_BASE_URL;
  process.env.UMAMI_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  try {
    const {status,data} = await fetchUmami('test', '2026-11-13T00:00:00Z', '2026-11-13T13:00:00Z');
    assert.equal(status,'connected');
    assert.equal(data.pageviews,10);
    assert.equal(data.bounceRate,20);
    assert.equal(data.visits,5);
    assert.equal(data.bounces,1);
    assert.equal(data.totalDuration,120);
    assert.deepEqual(data.pages,[{path:'/accounts/:id',views:10}]);
    assert.deepEqual(data.referrers,[{name:'example.org',events:6}]);
  } finally {
    if (saved === undefined) delete process.env.UMAMI_BASE_URL;
    else process.env.UMAMI_BASE_URL = saved;
    await new Promise(resolve => server.close(resolve));
  }
});
