# FinancialAssistant: owner and agent release workflow

Updated 2026-10-04. This is project-local preparation; no deployment, cloud mutation, installation, publishing or paid service is authorized by these files. AGENTS/skills are guidance; a local PASS cannot enforce GitHub permissions or authenticate an owner.

## Owner path

1. Describe the idea and desired visible outcome. The agent records scope, existing dirty files, impacted data/content, tests and stop conditions before edits. Preserve other work; do not reset or broadly stage the checkout.
2. Review an isolated candidate using fictional data. The agent gives one plain-language packet: what changes, who is affected, tested/untested behavior, expected costs/limits, recovery path and remaining risk. Evidence has exactly PASS, FAIL, BLOCKED or NOT_APPLICABLE; an unrun check is BLOCKED.
3. Approve only an exact candidate, target and manifest hash. Suggested decision: “Tôi duyệt bản [releaseId], mã kiểm tra [manifestSha256], cho [targetId], với phạm vi và chi phí trong phiếu này.” A draft approval is not a decision. Any source, migration, artifact, config, evidence or packet change invalidates approval. The owner need not run code or handle secrets.
4. The authorized release operator separately verifies permissions and executes the approved action. A checker PASS means local evidence matched; it always returns releaseAuthorized=false and performs no release. High-impact security changes and live transmission require explicit approval.

## Current project boundary

Remain offline. Money uses integer minor units and explicit currencies; verify conservation, transfers, undo and allocation without floating-point drift. Actual, planned and proposed amounts must remain distinct; forecasts do not silently book transactions. Rehearse schema migration and restore on synthetic old, corrupt and future-version snapshots; validate counts and balances before activation and preserve the old dataset on failure. Browser origin changes affect storage availability. Couples A/B labels are not authentication or privacy isolation. Do not import real financial files or add bank, price, cloud or Supabase integrations in this workflow.

## Offline candidate and recovery

Use source snapshots or a reviewed Git commit; never fabricate a commit for a folder without Git. Hash packaged HTML/APK/IPA/source artifacts and known inputs. Isolate tests from personal saves and real data. Rehearse compatibility with the oldest supported save and client, corrupt/interrupted writes, future-version rejection and backup/restore without overwriting the original. Record checksum, source state, runtime/engine, platform, test device and unresolved usability/accessibility checks.

Keep cloud/migration checks NOT_APPLICABLE because this workflow has no cloud backend; manifest migrations must be empty. Future hosting/accounts/live adapters are separate feature gates. Distribution/store upload, physical installation and signing are separate owner-authorized actions; the local checker performs none. Recovery may require a forward-compatible save reader: old binaries cannot necessarily read a migrated save. Set RPO/RTO only after measured restore tests, and label suggested targets as proposals.

## Read-only local evidence check

Run from this project root with existing Node (no install):

```powershell
node --test scripts/release-evidence.test.mjs
node scripts/release-evidence.mjs <manifest.json> <approval.json>
```

Result type is EvidenceBundleValidation, never production approval. Exit 0 = PASS (evidence only), 1 = FAIL (invalid/mismatched evidence), 2 = BLOCKED (missing evidence/target/approval or known blocker). Neither a hash nor a PASS proves test truth, independent review, permission enforcement or complete dynamic dependency discovery. Profile changes are control changes and need separate review. Mandatory policy.profileSha256, policy.runbookSha256 and policy.checkerSha256 bind exact release-profile.json, this runbook and the executing checker independently of inputRoots. Omitting policy files from inputRoots does not bypass their hashes. Known-input roots are a starting execution inventory: review platform assets/build scripts and add any additional release inputs before recording a candidate.

Existing focused checks to select by actual change:

- npm.cmd test

The checker never runs those commands or opens an environment file. Required profile check IDs must all pass with hashed, sanitized local evidence. NOT_APPLICABLE is accepted only when the profile permits it, a specific reason is supplied and scope evidence is hashed. Do not paste tokens, provider output, raw journals, real financial data or private account information into evidence.

## Manifest and approval contract

Store candidate JSON and evidence outside docs/release/input roots to avoid circular hashes; keep it private and sanitized. Format version 1:

- schemaVersion: 1; projectId: financial-assistant; mode: offline; releaseId: unique reviewed candidate ID; target: {id, kind} exactly matching the profile allowlist. 
- source: {kind: git, repoRoot: actual Git top-level, commit: full 40-character SHA, inputs: [{path, sha256}]}. Git candidates require clean tracked state. For an offline folder without Git use kind: snapshot, commit: null, snapshotId: unique identifier and all known input hashes. Never use snapshot to bypass a dirty existing Git checkout.
- artifacts: nonempty [{path, sha256}] for the built files. All file paths use safe project-relative forward slashes; no symlinks, traversal, credential files or node_modules.
- migrations: []; adding SQL migrations fails this offline profile.
- config: {expectations: nonsecret reviewed target/schema/runtime/feature expectations, expectationsSha256: SHA-256 of UTF-8 JSON.stringify(expectations)}. Never include credential values.
- policy: {profileSha256, runbookSha256, checkerSha256}; hash the exact profile, RELEASE_RUNBOOK.md and the executing release-evidence.mjs bytes even if inputRoots excludes them.
- checks: [{id, status, evidence: {path, sha256}, reason?}], matching requiredChecks. Evidence must be a structured JSON receipt: {schemaVersion: 1, checkId, status, sourceIdentity: exact commit or snapshotId, testedBundleSha256: tested scope digest, target: complete manifest target object, command, exitCode, environment, executedAt: ISO timestamp, reason?}. PASS requires receipt status PASS and exitCode 0; allowed NOT_APPLICABLE requires matching reason and exitCode null. Contradictory receipts, text-only claims and mismatched source/target fail. These are still self-reported receipts; the checker cannot prove the command ran or the author is trusted. Attach independent CI/device/test provenance to the owner packet.

Compute testedBundleSha256(manifest) with the exported helper in scripts/release-evidence.mjs after source/input, artifact, migration, configuration and policy hashes are finalized. Its canonical scope includes schema/project/mode/release identity, full target, source identity and sorted input/artifact/migration path+hash sets, config and policy. It deliberately excludes checks/receipt hashes, owner packet and approval, avoiding a cycle. Object keys and file-list ordering are normalized; receipt body changes cannot change the tested digest. Every receipt must contain this digest. Changed tested artifact bytes, input hashes, config, policy or release identity require new actual test evidence and a new receipt; a fresh owner approval or recalculated evidence-file hash alone cannot reuse an old receipt. The checker checks this binding, not whether tests actually ran.
- ownerPacket: {path, sha256} for the completed packet below. Hash the final manifest's exact file bytes.
- Separate approval JSON: {decision: APPROVE, owner: decision author, releaseId, targetId, manifestSha256, approvedAt: ISO UTC timestamp, expiresAt: later ISO UTC timestamp, revoked: false}. The approval timestamp must be parseable and not future; expiry is mandatory and must not have elapsed. Missing revocation state or revoked=true blocks. The release operator verifies the actual owner's decision and current revocation independently; self-authored JSON cannot prove human identity or a live revocation registry.

Use docs/release/OWNER_PACKET.vi.md as a template. A release manifest is not prepared by this documentation update; current builds and live environments have not been certified.
