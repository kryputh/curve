# Curve local prototype API contract

Express binds 127.0.0.1:3001; Vite proxies /api from 5173. Persistent PGlite PostgreSQL at data/curve-postgres. Synthetic fixtures are clearly marked and never inserted into newly enrolled projects. This is not a production SCF service or compliance certification.

## Authentication

- POST /api/auth/demo {role:'operator'|'tenant'} -> {user,session,mode:'local-demo'}. user/session both {id,role,name}. HttpOnly SameSite=Strict session cookie expires in eight hours.
- GET /api/auth/me -> same shape or 401; POST /api/auth/logout invalidates cookie.
- Tenant sees demo-project and its own creations. Operator sees all. Unauthorized project IDs return 404 on every project-specific route.
- Local hostname and Origin guards only. Selectable demo roles are NOT production authentication. No public deployment supported.

## Projects and dashboard

- GET /api/projects -> {projects:[{id,name,domain,network,isDemo,createdAt,umamiWebsiteId}]}.
- POST /api/projects {name,domain,network,umamiWebsiteId?} -> 201 {project,apiKey}. Domain is a hostname without scheme/path; network mainnet/testnet. Only operator may bind Umami website UUID after external ownership verification. Tenant-supplied Umami UUID returns 403. Key hashes stored; raw key returned once.
- `CURVE_ENROLLMENT=approval` makes new tenant projects pending and blocks web provisioning and OTLP collection until the operator calls POST /api/projects/:id/approve. Default mode is open.
- GET /api/projects/:id/overview?days=7|30|90|365|731 -> {project,days,metrics,series,pages,endpoints,sources,quality,recentEvents,methodology,web,sourceStatus,period,countries,devices,browsers,referrers}.
- metrics: {pageviews,visitors,apiRequests,acceptedEvents,excludedEvents,errorRate,p50Latency,p95Latency,activeDays,bounceRate,avgDuration}. Rates percentages; API latency milliseconds; web duration seconds. Percentiles may be null: absent histogram or percentile in unbounded overflow bucket. Never render null as zero.
- series: [{date,web,api}] spanning UTC midnight today minus days-1 through now. pages [{path,views}]; endpoints [{path,requests,errorRate,p50Latency,p95Latency}]; sources [{name,events}].
- The overview, each endpoint, and the evidence report include `statusCodes` as `[{status,count}]`. Each count is the number of requests, summed from the ingested points for that status in the reporting period. Global machine-access metrics include each project's distribution.
- quality: {duplicate,bot,invalid,accepted,coverageDays,lastEventAt,scope}. Duplicate/invalid counts are lifetime; accepted is selected-period. Bot count is not imported (zero is not proof of no bots). Live web freshness/coverage unknown; coverage concerns local API/demo observations.
- GET /api/projects/:id/events?limit=50 -> {events:[{id,type,path,count,status,duration,timestamp,source,disposition,...}]}. These are aggregated observations, NOT individual requests. Maximum limit 100.
- API reports read UTC daily aggregates by project, route, status and histogram layout. Only first-time accepted points increment the aggregates. Percentiles combine compatible bucket bounds across days. Service mode retains raw diagnostics and replay keys for eight days and daily API aggregates for 24 calendar months. This policy does not configure Umami's web retention.
- web: {visitors,bounceRate,avgDuration,countries,devices,browsers,referrers}; arrays [{name,events}], also top-level.
- sourceStatus.web: synthetic|connected|not-configured|unavailable; sourceStatus.api: synthetic|connected|awaiting-data. Zero placeholders for unavailable sources are NOT measured zero traffic.

## Exports, keys and administration

- GET /api/projects/:id/evidence?days=30 -> downloadable {schemaVersion,generatedAt,project,period,metrics,quality,methodology,sourceStatus,limitations,digest}. SHA-256 canonical sorted JSON, excluding digest; Dates ISO serialized. Integrity only, not independent authenticity or human traffic proof.
- GET /api/projects/:id/export?days=30 -> CSV date,pageviews,api_requests.
- POST /api/projects/:id/web -> {project}. Owners or operators can provision a managed Umami site. The stable property ID and locked binding make retry safe. Existing external bindings are reused.
- GET /api/projects/:id/integration -> {script,canProvision,serverExample,endpoint,privacyNotes,umamiConfigured}. The snippet is null until a site is bound and the operator has configured the gate and pinned tracker.
- GET /vendor/:filename serves only valid content-addressed tracker assets with CORS and immutable caching.
- The pinned helper obtains a one-use token from GET /api/web-challenge. The tracker submits a pageview to POST /api/send. These endpoints admit the registered site's origin, apply privacy settings and rate limits, and relay sanitized events to private Umami. Project evidence includes period-level web gate outcomes where configured.
- POST /api/projects/:id/keys/rotate -> {apiKey}; DELETE /api/projects/:id/keys -> {revoked:true}.
- DELETE /api/projects/:id -> operator-only deletion including retained metrics; fixtures cannot be deleted.
- POST /api/operator/read-keys -> operator-only {id,apiKey,scope:'global:metrics:read'}.
- DELETE /api/operator/read-keys/:keyId -> revoke; GET /api/metrics?days=30 with read-key Bearer -> {projects:[{project,metrics,sourceStatus}]}.

## OTLP/HTTP

POST /api/otlp/v1/metrics with Bearer project ingestion key. Supports `application/x-protobuf` and `application/json`, including gzip requests. The body limit is 512 KB after decoding. Each project can send 120 exports per minute and up to 2000 supported data points per request.

- resourceMetrics[].scopeMetrics[].metrics[] containing explicit-bound histogram or sum. Supported names: http.server.request.duration, http.server.duration, http.client.duration, http.server.request.count, http.server.requests.
- Ingests delta temporality for explicit-bound histograms and sums. For cumulative SDKs, use the dedicated Collector Contrib branch in `examples/otel-collector.yaml` to convert without modifying the existing APM export. Exponential histograms are outside the implemented subset.
- Attributes: tenant.id must match key project, service.name, http.route preferred (url.path/http.target fallback), http.response.status_code or http.status_code required.
- Use ONE canonical instrument per service/route/status. Histogram already counts requests. Mixed counter/histogram and different duration instruments rejected in batch AND across exports. Migrations require deliberate operator data migration.
- Timestamp maximum age 7 days, future allowance 5 minutes. Non-negative integer counts max 10 million. Histogram bounds/counts validated. Unit s converted to milliseconds; otherwise supply milliseconds.
- Numeric IDs, G/C/M addresses, UUIDs, hashes, query strings normalized/redacted. Prefer route templates. Arbitrary attributes, exemplars, trace IDs, IPs, logs, URLs and request bodies not persisted.
- SHA-256 normalized observation IDs suppress exact replays. Authorized fabricated traffic remains possible and explicitly disclosed.
- Response {partialSuccess:{rejectedDataPoints,errorMessage},accepted,duplicate}. Unknown metric names discarded/count rejected; invalid input 400. Subset does not claim full OTLP conformance.
- POST /api/otlp/v1/traces and /logs authenticated then discarded without persistence.
- POST /api/collect returns 400; GET /tracker.js returns 410. Web metrics must use Umami frontend instrumentation, no independent replacement tracker.

## Umami and limitations

UMAMI_BASE_URL, UMAMI_USERNAME and UMAMI_PASSWORD stay server-side. Operator-bound website UUID read through Umami stats/pageviews/metrics endpoints. All use same UTC range as API data. Missing config -> not-configured; upstream error/timeout -> unavailable, never fabricated traffic. Live Umami adapter requires validation against a running instance.

GET /api/health -> {status:'ok',mode:'local',database:'PGlite PostgreSQL',productionReady:false}.

Still required for production: real identity, ownership/provisioning, scalable PostgreSQL deployment, quotas/cardinality/load tests, full bot/privacy controls and assessment, 24-month aggregate retention operations, backups, monitoring and real adoption/handover evidence.
