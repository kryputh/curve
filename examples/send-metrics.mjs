// A synthetic OTLP fixture for integration checks, not evidence of real adoption.
// Set CURVE_PROJECT_ID and CURVE_PROJECT_KEY in your terminal environment.
const projectId = process.env.CURVE_PROJECT_ID;
const key = process.env.CURVE_PROJECT_KEY;
if (!projectId || !key) throw new Error('Set CURVE_PROJECT_ID and CURVE_PROJECT_KEY for a new test project.');
const endpoint = process.env.CURVE_ENDPOINT || 'http://127.0.0.1:3001/api/otlp/v1/metrics';
const now = BigInt(Date.now()) * 1_000_000n;
const str = (key, value) => ({ key, value: { stringValue: value } });
const body = {
  resourceMetrics: [{
    resource: { attributes: [str('tenant.id', projectId), str('service.name', 'synthetic-integration-check')] },
    scopeMetrics: [{ scope: { name: 'curve-example', version: '0.1.0' }, metrics: [{
      name: 'http.server.request.duration', unit: 's',
      histogram: { aggregationTemporality: 1, dataPoints: [{
        attributes: [str('http.route', '/api/payments/:id'), { key: 'http.response.status_code', value: { intValue: '200' } }],
        startTimeUnixNano: String(now - 60_000_000_000n), timeUnixNano: String(now),
        count: '10', sum: 1.4, explicitBounds: [0.1, 0.25, 0.5, 1], bucketCounts: ['4', '5', '1', '0', '0'],
      }] },
    }] }],
  }],
};
const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
if (!res.ok) throw new Error(`Collector returned ${res.status}: ${await res.text()}`);
console.log('Synthetic 10-request integration fixture sent:', await res.json());
