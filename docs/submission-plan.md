# Curve: draft SCF submission plan

Prepared 13 November 2026. This is a planning document, not a submitted application or a claim of eligibility. Complete evidence fields and update the implementation matrix after the final test run.

## Proposal draft

**Project:** Curve — usage evidence for Stellar builders and SCF reviewers.

**Problem:** Reviewers need comparable adoption measurements with enough context to distinguish observed usage from incomplete instrumentation, synthetic demonstrations and applicant assertions. Builders need a low-effort way to report the same measurements they use to operate their projects.

**Proposed solution:** An Umami-based web analytics service paired with an OpenTelemetry metrics collector and PostgreSQL. Private tenant workspaces and a restricted operator workspace expose standardized usage and performance measurements. A reviewer evidence export records the period, measurement definitions, ingestion freshness, exclusions and reproducible digest. Integration diagnostics and an operational handover rehearsal make the service inspectable beyond the dashboard.

**Architecture decision:** Pin Umami v3.5.0 as the integration target, subject to release/security recheck before deployment. Use PostgreSQL for deployed storage; embedded PostgreSQL through PGlite supports local prototype workflows. The prototype's live Umami adapter must be validated against an actual configured instance before claiming live compatibility. Application logic, infrastructure, operational guidance and acceptance tests belong in the same repository.

**Team and fit (working draft):** The lead reports membership in the GrantFox team, participation in Drips and GrantFox, and building an open-source application with more than 150 contributors. The proposed Curve team also reports affiliations with GrantFox, Neko and Oppia Labs. SCF's public records confirm [GrantFox received a Build Award in round #40](https://communityfund.stellar.org/submissions/rechsG6zSfsxxGqxw). This establishes the project's SCF history. The team should document each named member's role, dates and concrete contributions so SCF can assess the applicant's connection to that history.

Evidence to attach before submission: [applicant and team roster], [lead's GitHub profile], [150+ contributor repository and dated contributor count], [GrantFox contributions or maintainer references], [Neko and Oppia Labs contribution links], [team's dated SCF/SDF work], [named support owner and backup].

**Pilots:** GrantFox is a candidate for an early web or API pilot given the team's reported relationship and the project's verified award. Seek owner agreement, select two other awarded projects for web instrumentation, and identify the API pilot and operational contact. Keep candidate and committed pilot lists separate until project owners agree.

**Hosting and stewardship:** [Hosting provider and region]. [Operator account owner]. [Backups and recovery ownership]. [Community successor selection process]. [Domain/repository/data transfer plan]. The operational commitment is conditional on an agreed budget and a named delivery team.

Primary requirement source: [SCF RFP Track](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/rfp-track). Deadline/eligibility findings and comparison sources are in [research.md](research.md).

## Decision and advantage matrix

| Choice | Why it helps | Demonstration needed | Claim to avoid |
|---|---|---|---|
| Extend Umami | Reuses an allowed foundation and established web analytics | Working live adapter, pinned dependency, license notices | Calling a standalone demo a complete Umami deployment |
| Constrained OTel collector | Gives API metrics a clear schema and privacy boundary | Standard OTel export reaches a tenant report; prohibited payloads rejected/discarded | Calling ordinary custom JSON an OTel integration |
| Evidence receipts | Makes a reported result reproducible and changes detectable | Regenerate a receipt and verify its digest | Calling a checksum proof of genuine humans |
| Coverage and exclusions | Exposes incomplete instrumentation and filtering effects | Simulated outage and traffic-quality exercise | Calling an arbitrary score objective truth |
| Handover rehearsal | Shows maintainability by someone outside the authors | Fresh environment restoration by a second operator | Equating a Docker file with completed handover |
| Minimal data | Reduces the amount of sensitive information involved | Inspect network payloads, stored columns and operational logs | Advertising blanket legal compliance |

## Candidate budget and tranches

**Planning estimate: $50,000 total.** This is an internal candidate allocation, not an SCF offer, vendor quote or final requested amount. It assumes the scope can be delivered by the named team and includes an allocation for the required operational period. Validate tax, hosting, support and review costs before submission.

| Milestone | Share | Estimate | Reviewable outcome |
|---|---:|---:|---|
| 1. Specification and working vertical slice | 10% | $5,000 | Eligibility and pilot route confirmed; architecture, data inventory and threat model; actual browser event to isolated dashboard; reproducible local setup |
| 2. Core collection and access control | 20% | $10,000 | Umami integration; OTel metrics pipeline; route normalization; tenant/operator authorization; secret rotation; meaningful automated isolation and privacy tests |
| 3. Pilots, review workflow and operating evidence | 30% | $15,000 | Real pilot instrumentation; side-by-side reviewer workflow and evidence export; load results, retention jobs, recovery exercise and privacy review outcomes |
| 4. Release and handover readiness | 40% | $20,000 | Complete acceptance matrix; tenant/operator demonstration; production runbooks, monitoring, transfer rehearsal, and a funded hosting/support plan |
| **Total** | **100%** | **$50,000** | |

Candidate cost envelope within that total: engineering $30,000; independent security/privacy review $5,000; twelve-month hosting/backup/monitoring reserve $6,000; support and handover $6,000; contingency $3,000. These sum to $50,000 and require actual quotations and staff commitments. If credible availability requires more redundancy or support, revise the estimate rather than silently reducing scope.

Suggested development sequence is six to eight weeks **after access, eligibility and pilot participation are confirmed**, followed by the specified operational period. This is a proposed delivery schedule, not a promise that a production platform can be safely completed before the application deadline.

## Proposed service commitments for review

The RFP's operational targets need an explicit feasibility assessment. Candidate commitments: ingestion availability 99.99%, dashboard availability 99.90%, high/critical vulnerability remediation within 24 hours, support response within five business days and resolution within ten. These are **unvalidated targets**, not measured current service levels.

Before committing, define availability windows, independent probes, planned-maintenance treatment, incident ownership and escalation coverage. A 99.99% target allows very little downtime; one unattended instance cannot substantiate it. Resolve dependency failures, delayed patches and tickets requiring upstream fixes in the agreed support policy. Do not imply SCF has accepted an SLA.

## Implementation evidence matrix

Local verification uses `npm test`, `npm run build` and the browser walkthrough. Production and pilot evidence remain separate gates.

| Area | Required implementation evidence | Current claim status |
|---|---|---|
| Umami foundation | Pinned deployment plus live adapter integration | Compose and adapter present. Adapter tested against a fixture. Live instance verification pending. |
| Browser collection | Versioned snippet, event delivery and frontend-only strategy | Managed property, pinned tracker and one-use challenge verified in Chromium with a simulated Umami API. Live Umami and pilot confirmation pending. |
| Privacy | Data inventory, minimization, retention, logs and residency review | API attribute discard and route normalization tested. Deployment-specific privacy review pending. |
| Traffic quality | Synthetic/bot checks with measured exclusions and limitations | API replay filtering and web challenge replay, origin checks and payload minimization tested. Web gate diagnostics record forwarded attempts, suspected bots, rate limits and upstream failures. Real pilot calibration remains. |
| API ingestion | Standard OTel payload fixture and actual exporter test | Authenticated JSON and gzip protobuf delta histograms pass. Collector Contrib dual export still needs an integration run. |
| PostgreSQL persistence | Restart preserves data; deployment migrations run successfully | Local PGlite reopen, daily backfill and expiry tests pass. Authenticated ingest and retention also passed on standalone PostgreSQL 18.6. Hosted migrations and restore exercise pending. |
| Isolation | Unauthenticated and wrong-tenant reads/writes fail | Local role authorization tests pass. Production identity and tenancy pending. |
| Operator access | Restricted global view and lifecycle controls | Comparison and demo role switch exercised in browser. |
| Machine credentials | Scoped key issuance, rotation and revocation tests | Scoped issuance and revocation exercised by API tests. |
| Metrics | Definition-level count, status, percentile and time-window tests | API request count, project and endpoint HTTP status counts, and unbounded latency tested. The browser shows per-endpoint code counts and the evidence export includes project totals. Broader benchmark pending. |
| Evidence export | Content reproduces and digest detects modification | Downloaded report verified. Tamper detection passes automated test. |
| Operational scale | Recorded load test and bounded resource use | Not demonstrated |
| Long-term retention | Scheduled aggregate retention and restore test | Not demonstrated |
| Real adoption | Consenting named pilot projects with live measurements | Not established |
| Support and handover | Named owners, funded plan and independent transfer exercise | Not established |

## Submission gates and unresolved inputs

1. Confirm the applicant is eligible under the RFP's explicit exclusion of unknown-to-SCF builders. Building software does not waive this rule.
2. Obtain the original RFP submission URL and confirm its exact year, date and time. The screenshot deadline has not been independently verified.
3. Secure genuine pilot commitments, then document live adoption without exposing private data.
4. Obtain a deployment-specific privacy assessment, including consent-exemption boundaries, residency and any erasure obligations. Do not claim universal GDPR compliance from an SDK setting.
5. Replace every blank credential, cost assumption, operating target and implementation status with evidence before submission.

No public outreach, application submission, paid hosting purchase or legally binding service commitment has been made by preparing this document.
