# FinancialAssistant agent instructions


## Release evidence workflow - 2026-10-04

Read [the project release runbook](docs/release/RELEASE_RUNBOOK.md) for staging, packaging, production planning or a release handoff; use [the Vietnamese owner packet](docs/release/OWNER_PACKET.vi.md). Review docs/release/release-profile.json and run node --test scripts/release-evidence.test.mjs for changed gate code. The read-only checker uses immutable source/artifact/config/evidence hashes and exact target approval; it performs no deployment and does not enforce remote permissions. Preserve dirty work and current migration blockers. Keep this application offline; cloud dependencies and live transmission remain separately approved future work.
