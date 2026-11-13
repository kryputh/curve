# Curve

Website and API analytics for Stellar projects, built on Umami, OpenTelemetry and PostgreSQL. Project owners register, enroll their application, install a pinned browser tracker and export HTTP metrics. Operators approve enrollment, compare usage and issue read-only reporting keys. Reports include metric definitions and collection limitations.

## Run locally

Requires Node.js 24 or later.

```sh
npm ci
npm run dev
```

Open [Curve](http://127.0.0.1:5173), create an account and add a project. Normal startup uses real accounts and an empty database, persisted in `data/curve-service` using PGlite PostgreSQL. Configure both sources below to receive usage. Missing sources are shown as unavailable.

To create an operator, stop the local server, supply `CURVE_OPERATOR_USERNAME` and `CURVE_OPERATOR_PASSWORD` as environment variables, run `node scripts/create-operator.mjs`, then restart. The script refuses to overwrite an existing username. Local PGlite supports one application process.

For shared deployment, set `CURVE_DATABASE_URL` to a separate PostgreSQL database. Set `CURVE_PUBLIC_ORIGIN` to the HTTPS origin behind a configured reverse proxy. Run `npm run build` and `npm start`. See [operations](docs/operations.md) for the complete container setup and enrollment policy.

In Evidence room, download a report and check its digest:

```sh
node scripts/verify-evidence.mjs path/to/report.json
```

The digest can detect edits relative to a saved digest. Publisher authenticity and traffic validity require separate evidence.

To connect API collection, use [the complete dual-export configuration](examples/otel-collector.yaml) with your existing OpenTelemetry Collector and the project's ingestion key. Curve accepts OTLP/HTTP JSON and gzip protobuf delta histograms. Keep your existing APM destination. To check a test project, set `CURVE_PROJECT_ID` and `CURVE_PROJECT_KEY` and run `node examples/send-metrics.mjs`; that example sends a synthetic ten-request histogram.

## Connect Umami

Follow [operations.md](docs/operations.md) to start private Umami and PostgreSQL. Configure `UMAMI_BASE_URL`, `UMAMI_USERNAME`, `UMAMI_PASSWORD` and `CURVE_WEB_GATE_SECRET`. Pin the tracker using `scripts/pin-umami-tracker.mjs`, set `CURVE_TRACKER_FILE`, and restart Curve. In Integrations, select **Connect website analytics** and install the generated snippet. The browser gate minimizes payloads and rejects invalid origins and challenge replays. Bot filtering does not prove personhood.

Use `npm test` and `npm run build` for automated validation. `npm start` serves the built client and API on port 3001. The live checks are `scripts/smoke-umami.mjs` and `scripts/smoke-otel.mjs`; see operations for their configuration. [Restore verification](docs/restore.md) requires PostgreSQL client utilities.

Daily API aggregates and stored web totals have a 24-month retention policy. Web history shows captured and missing days separately. Daily visitor estimates are never presented as unique visitors over a longer period; detailed web reports still depend on Umami's retained data.

An explicit `npm run dev:demo` opens a separate synthetic preview with selectable roles. Demo authentication is disabled in the normal application.

Implementation and local validation are ongoing. Production hosting, recovery rehearsal, privacy review, actual pilots and support ownership remain acceptance gates. No funding, adoption or availability guarantee is claimed.

- [RFP and competitor research](docs/research.md)
- [Proposal and submission gates](docs/submission-plan.md)
- [Architecture and production gates](docs/architecture.md)
- [Full-service delivery plan](docs/delivery-plan.md)
- [API and integration contract](docs/contract.md)
