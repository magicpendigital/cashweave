---
name: financial-assistant-release
description: Prepare and review an offline FinancialAssistant candidate with source and artifact identity, persistence recovery evidence and owner acceptance.
---

# FinancialAssistant release review

Read AGENTS.md and docs/release/RELEASE_RUNBOOK.md in this repository. Preserve dirty source and real saves. Keep the current offline architecture; do not add Supabase, accounts or cloud services. Remain offline. Money uses integer minor units and explicit currencies; verify conservation, transfers, undo and allocation without floating-point drift. Actual, planned and proposed amounts must remain distinct; forecasts do not silently book transactions. Rehearse schema migration and restore on synthetic old, corrupt and future-version snapshots; validate counts and balances before activation and preserve the old dataset on failure. Browser origin changes affect storage availability. Couples A/B labels are not authentication or privacy isolation. Do not import real financial files or add bank, price, cloud or Supabase integrations in this workflow.

Select existing checks by the actual diff. Record PASS, FAIL, BLOCKED or NOT_APPLICABLE and sanitized evidence. Hash the exact source/snapshot, built artifacts and packet; an edit invalidates approval. Run the portable read-only checker at scripts/release-evidence.mjs with the reviewed manifest and separate owner approval; it verifies local evidence and never grants release authority. Stop for missing evidence or unapproved distribution, device installation, signing or external transmission.
