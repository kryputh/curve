# Curve: SCF analytics opportunity research

Research date: 13 November 2026. Source pages were opened live; search snippets were not treated as the current specification. Recommendations below are product judgments, not claims of funding eligibility or competitor exclusivity.

## Decision

Build a reviewer-oriented evidence and operations layer around **Umami**, with a separate OpenTelemetry metrics pipeline. The strongest proposed advantage is making the limits, provenance, completeness, and reproducibility of adoption data visible. Ordinary traffic charts, cookieless analytics, team permissions, and export APIs already exist.

## Official RFP: decisive requirements

The current [SCF RFP handbook](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/rfp-track) confirms this analytics opportunity. Important constraints:

- Umami or GoatCounter foundation; PostgreSQL; open-source monorepo and infrastructure.
- Frontend-only web collection, pinned tracker versions, bot/inflation mitigation, privacy documentation and private tenant/global operator dashboards.
- Dual-export OpenTelemetry ingestion; discard heavy APM payloads, normalize routes, aggregate request counts/status/latency, retain aggregates for at least 24 months.
- Free service, self-enrollment with operator removal/approval controls, revocable machine-access keys, strict tenant isolation.
- Design load: about one million API requests daily.
- Required adoption evidence: three real SCF-awarded web projects and one API integration, demonstrated from operator and tenant perspectives.
- Twelve months of hosting/support after final approval, with an independently operable community handover.
- Unknown-to-SCF builders are excluded; prior maintenance, privacy/security work, and multi-year SCF/SDF history receive substantial weight. Weak experience can disqualify.
- The page lists an expected $40,000–$60,000 budget range, marked for internal review; do not treat this as a guaranteed award.

Read the full specification before submission; this summary is not an exhaustive compliance checklist.

## Deadline: unresolved primary-source discrepancy

The supplied screenshots say **November 20, 9 a.m. PT**, specifically for the two RFPs. They do not visibly show a year or a complete post URL. The live [SCF awards page](https://communityfund.stellar.org/awards) instead shows the general SCF #46 deadline as **November 9, 2026**, with the round in initial review. Earlier indexed variants showed November 8. The handbook confirms the two RFPs but does not state their closing date.

A distinct RFP deadline is a plausible explanation, but it is not independently confirmed here. Do not label the screenshot wrong or substitute the general round deadline. Obtain the original announcement/form or confirmation from SCF. If November 20, 2026, 9 a.m. Pacific is confirmed, it corresponds to **6 p.m. in Lagos**. The year's interpretation remains an assumption until verified.

## Existing tools and the remaining opportunity

| Tool | Verified capabilities | Implication for Curve |
|---|---|---|
| Umami | Open-source web/product analytics, self-hosting, teams, sharing and API-based extensions. PostgreSQL is supported. | Best starting point for a TypeScript-based implementation. Existing functionality reduces rebuild work; the SCF evidence workflow is the addition. |
| GoatCounter | Open-source/self-hosted privacy-oriented web analytics, cookies unnecessary, lightweight script, and alternate pixel/middleware/log ingestion. | Viable alternative, but Curve would need to disable incompatible alternate collection paths for this RFP and add the operator/API evidence workflow. |
| Plausible | Daily site-specific visitor identifiers, raw IP/user-agent not retained, no persistent device identifiers, browser automation checks and event/session aggregation. | Privacy and basic bot filtering are established capabilities. A rotating identifier is not an original differentiator. |
| PostHog | Privacy controls and event capture API; explicitly places responsibility for collected data and regulatory fit on the deployer. | Broad analytics functionality does not remove the need for a deliberately constrained SCF deployment and clear privacy boundaries. |

Primary sources: [Umami introduction](https://docs.umami.is/docs), [Umami installation](https://docs.umami.is/docs/install), [Umami team workspaces](https://docs.umami.is/docs/guides/setup-team-workspaces), [GoatCounter](https://www.goatcounter.com/), [Plausible data policy](https://plausible.io/data-policy), [PostHog privacy](https://posthog.com/docs/privacy), [PostHog capture API](https://posthog.com/docs/api/capture).

This is a focused comparison, not evidence that no competitor offers a particular feature. The defensible claim is a purpose-built SCF workflow with demonstrable results, not worldwide novelty.

## Proposed product advantage

### 1. Evidence receipts that explain what was measured

Every reviewer export should include the project, interval, metric-definition version, collector/tracker version, ingestion timestamps, excluded counts, and a reproducible digest. Reviewers should be able to regenerate the same report. A digest detects changed report contents; it does **not** establish that traffic came from humans or independently validate tenant assertions.

Acceptance experiment: export an interval, regenerate it under its original definition version, and verify matching content. Change a value and demonstrate verification failure. Never include secrets or personal identifiers in the receipt.

### 2. Coverage beside every adoption claim

Show collection start date, last received event, missing intervals, and whether the chosen period is fully covered. Avoid silently presenting a newly installed collector as a full month of usage. Compare projects only over overlapping collection periods, with consistent definitions.

Acceptance experiment: stop an integration for an hour, restore it, and show the gap in the reviewer export. Explain that late delivery and client blockers can also reduce observed coverage.

### 3. Explainable traffic quality

Separate accepted, suspicious, and rejected observations. Provide rule names and aggregate reasons without exposing raw IP addresses. Distinguish browser execution checks from proof of personhood. Shared networks and privacy tools can create false positives; operators need context, rather than an opaque universal trust score.

Acceptance experiment: submit a plain server POST, replay a browser challenge, and send high-rate synthetic traffic. Show each disposition and demonstrate that a genuine browser event still reaches the intended tenant.

### 4. A handover that can be rehearsed

Make an installation, backup restoration, key rotation and permissions audit reproducible by a second operator using only the repository. Publish the actual drill result and measured recovery time. This is stronger evidence than merely including deployment files.

Acceptance experiment: restore into a fresh database, check row counts and report hashes, then revoke an old credential and verify it stops working.

## Scope discipline

Prioritize the functional collector, tenant isolation, operator review, integration diagnostics and evidence export before decorative ecosystem rankings. Defer on-chain anchoring, AI-generated scores, cross-site identity, session replay, wallet identity enrichment and revenue attribution. These add complexity without demonstrating the central adoption-evidence claim.

Treat API measurements as tenant-instrumented observations. A tenant can fabricate its own telemetry; transport authentication alone does not make it independently measured. Never merge wallet addresses with browser identifiers to imply unique people. Country-level, aggregate reporting should be enough for the initial workflow.

## Evidence still needed from the applicant

- Existing open-source repositories and the applicant's actual maintenance history.
- Actual SCF/SDF relationship and eligibility confirmation.
- Original RFP announcement/application link and confirmed cutoff.
- Consenting pilot projects; no synthetic project may be represented as real adoption.
- Operational owner, funded hosting plan and realistic support commitments.
- Deployment-specific privacy assessment and selected data residency. A prototype must not advertise verified legal compliance.

None of these should be invented to strengthen the submission. A polished demo can demonstrate execution, but cannot substitute for eligibility, real pilots or independently operated service evidence.
