# Operations and handover plan

## Local preview

Use Node 24+, `npm ci`, then `npm run dev`. Dashboard runs on http://127.0.0.1:5173 and the API on http://127.0.0.1:3001. Development opens directly with full local developer access and no login. Projects persist in `data/curve-service`; a new database has no sample traffic. Keep both services loopback-bound. `npm run dev:demo` is a separate, explicit synthetic preview.

## Service mode

Provision a separate PostgreSQL database for Curve. Set `CURVE_DATABASE_URL` to its connection URL, build with `npm run build`, and run `npm start`. The server listens on loopback by default. Service mode uses persisted accounts and sessions and starts with no fixture projects. Tenants register through the sign-in screen. Bootstrap each operator via `node scripts/create-operator.mjs` with the username and password supplied in `CURVE_OPERATOR_USERNAME` and `CURVE_OPERATOR_PASSWORD`.

For a local container deployment, fill `infra/.env` from the example, including a separate random hex `CURVE_POSTGRES_PASSWORD`, then run `docker compose --env-file infra/.env -f infra/compose.yaml --profile service up -d --build`. Curve binds host port 3001 and Umami binds host port 3100, both on loopback. The two applications have separate databases and volumes. Supply operator credentials as environment variables to the operator bootstrap command in the Curve container, or run the command against the Curve database directly.

Set `CURVE_PUBLIC_ORIGIN` to the exact HTTPS origin when testing behind a TLS reverse proxy. That enables Secure cookies and restricts browser mutations to the configured origin. Finish the production gates in the delivery plan before accepting public tenants.

Enrollment defaults to open. Set `CURVE_ENROLLMENT=approval` and restart to hold new tenant projects pending operator review. In **Projects**, approve eligible applications. The pending project cannot provision a website or ingest metrics until approval. Previously approved projects remain approved. Operators can remove ineligible projects using the existing removal workflow.

CI provides a disposable PostgreSQL service via `CURVE_TEST_DATABASE_URL` to exercise account and ingestion paths against the network database. An ordinary local test run uses embedded PostgreSQL.

### API data retention and validation

The first upgrade backfills existing API records into daily aggregates once. Stop writers running the previous release before upgrading. Every accepted export then updates its UTC daily totals in the same transaction that records its replay key. Service mode expires raw API records older than eight days and daily API aggregates older than 24 calendar months, on startup and hourly. Recent diagnostics expire with raw records. Keep the database and collector clocks synchronized. This job does not manage Umami's separate database or backup retention.

To exercise ingestion capacity locally, set `CURVE_TEST_DATABASE_URL` to a disposable PostgreSQL database and run `node scripts/benchmark-api.mjs`. The benchmark sends authenticated OTLP/HTTP batches for 50 test projects, verifies totals and removes its own projects. It models a day of batched HTTP metrics. It does not generate a million individual instrumented application requests or exercise the production network, an upstream Collector, or the Umami service.

Local reference run (13 November 2026, PostgreSQL 18.6 on Windows): 1,200 HTTP batches contained 14,400 delta histogram points representing 1,008,000 requests. All batches were accepted, and the reconciled totals occupied 100 daily rows. Ingestion completed in 21.4 seconds with a 316.56 ms p95 HTTP batch response time. The workload uses one normalized route and two response statuses per project. A production load exercise needs more routes, mixed exporters, concurrent dashboard reads, network/TLS, longer duration and recovery under failure.

## Umami foundation

Copy `infra/.env.example` to `infra/.env`, fill unique secrets, then run `docker compose --env-file infra/.env -f infra/compose.yaml up -d --build`. The initial build requires Docker Engine and internet access. This creates a local Umami instance at http://127.0.0.1:3100 backed by PostgreSQL. Change its initial administrator password immediately. Create a website; use server environment variables documented in README for the read adapter. Umami code retains its upstream license. The source version is pinned; production must additionally lock the resolved commit and image digest after review.

Pin reviewed tracker bytes with `node scripts/pin-umami-tracker.mjs http://127.0.0.1:3100`. Set `CURVE_TRACKER_FILE` to the printed filename, keep the asset in `public/vendor` on the server, and set a random `CURVE_WEB_GATE_SECRET` of at least 32 characters. Use `CURVE_PUBLIC_ORIGIN` for the public HTTPS origin. Curve verifies the bytes against their content-addressed name before serving them, and serves both scripts with CORS for cross-origin SRI. Keep previous reviewed assets installed while tenants still use them. A hash verifies the pinned bytes, while build provenance depends on the reviewed source and build.

In **Integrations**, a project owner can connect website analytics. Curve creates one Umami website per project with a deterministic ID. The snippet loads an integrity-pinned helper and tracker. Keep Umami private so events pass through Curve before reaching the collector. Enable `ENABLE_CLIENT_SALT=1` in Umami. If Curve is behind an ingress, set `CURVE_TRUSTED_PROXY` to its exact IP/CIDR and ensure it strips and overwrites incoming forwarding headers. With no trusted proxy configured, Curve only uses the socket address. The gate truncates addresses for Umami geolocation and mixes a tenant-specific daily HMAC into session estimation. Raw client addresses do not reach Umami. Country and unique visitor counts are estimates. The browser handshake blocks unchallenged events and replays, and rate-limits bursts or many user agents on one address. It can be automated and does not prove personhood. The challenge and limiter currently live in one Curve process.

### Live smoke check

Use a dedicated local Umami instance and an initialized account that can create and delete test websites. Set `UMAMI_USERNAME`, `UMAMI_PASSWORD`, and `CURVE_CHROMIUM` (path to Chrome or Chromium) in the shell. Run `node scripts/smoke-umami.mjs`. The check provisions a tenant property, serves the generated snippet on a different origin, opens it in a fresh browser profile, and waits for the page view to pass through Curve's gate and Umami into the project overview. It cleans up its temporary website and browser profile. Public ingress and proxy behavior require separate testing.

The manual GitHub Actions workflow **Live Umami smoke check** starts the stack on a fresh runner and executes the same check. An actual successful run is needed as evidence of live integration.

## Proposed hosting baseline — not yet provisioned

EU region for all primary data, backups and logs; document exact provider/region before onboarding. Use independent ingress and dashboard health probes. Alert on ingestion failures, freshness gaps, queue lag, elevated rejection rate, disk pressure and failed backups. No raw telemetry payloads in application or proxy logs. Minimize diagnostic metadata and expire it deliberately.

Create nightly encrypted PostgreSQL backups, with a proposed 30-day backup lifecycle and quarterly restore rehearsals. Separately retain daily aggregates for at least 24 months. Define RPO/RTO after measuring restoration and discussing operating budget; these are not current guarantees.

## Incident procedure

1. Record incident start, impact and owner without copying personal payloads.
2. Revoke compromised credentials; disable affected ingestion routes or tenant access as appropriate.
3. Preserve necessary minimal audit evidence and restore from a known-good deployment.
4. Validate tenant isolation, ingestion, dashboards and historical aggregates.
5. Document cause and prevention. Notify affected people through approved channels according to the incident plan and applicable requirements.

## Handover acceptance

At month 6–12, a designated successor rebuilds from the monorepo, restores a backup in an isolated environment, rotates credentials, checks domain transfer/redirect, runs the acceptance tests and serves real tenant metrics. Transfer repository ownership, domain control, support history and operator documentation. Record signed acceptance by the actual parties; do not prefill it.

The proposer must fund 12 months hosting/support after the final tranche. Proposed availability and support targets must have an identified owner and budget before submission. No hosting is currently purchased or publicly deployed by this repository.
