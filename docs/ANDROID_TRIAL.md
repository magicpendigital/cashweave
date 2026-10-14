# CashWeave Android trial candidate

## Current source handoff status — 2026-10-14

**Current native QA: BLOCKED / NOT RUN for this handoff source. No current APK is included or present at the checked local output path.** Fresh lint, native build, binary permissions/signature inspection and Android runtime/upgrade checks are still required. The proposed CAMERA lint suppression in the current source has not received fresh native lint verification. Source-only handoff, repository review or memory mock PASS does not authorize deployment, installation, signing changes or bypassing native gates.

## Historical checkpoint boundary — recorded 2026-10-10

Everything below this boundary describes the earlier isolated V4 Android checkpoint, identified by historical APK SHA256 aac3210ea2981754ce3e4f60a3782d5b0bdf61aaa79c31dea84e18f0880e83f7 (4,029,151 bytes), not the current local/Marketing handoff snapshot. The historical document recorded native build/binary inspection PASS, lint FAIL and runtime BLOCKED. Its 219/219 and 37/37 counts, tools, permissions, signer and SDK-agreement receipts apply only to that historical checkpoint. The complete historical source-input manifest/43-input digest is not present in this curated handoff and was not reverified here; do not infer source equality or bind its PASS to today's files. The APK hash is an artifact identifier, not a source snapshot digest.

Current live source boundary is the reviewed141-file allowlist SHA256 e9392ac7553d41b91c94d6e81cf979032f1cee8e3bc87839244f454d59cf4dc0. This new Git candidate has documentation-only edits to two guides, bound by its separate candidate manifest. Historical evidence/mobile references below are archival references; those receipts and the historical APK are deliberately not shipped in this source-only candidate. No historical signer/SDK approval is a current signing/device-install decision. See the current README for source setup and pending pre-push gates.

## Historical — Exact artifact and identity

- APK: `android/app/build/outputs/apk/debug/app-debug.apk`
- Size: **4,029,151 bytes**
- SHA-256: `aac3210ea2981754ce3e4f60a3782d5b0bdf61aaa79c31dea84e18f0880e83f7`
- Application ID / namespace: `app.cashweave.offline.trial`
- Version name: `0.4.1-trial.1`; version code: `40101`
- Minimum Android API 24; target/compile API 36. A current supported Android System WebView is required for BigInt, IndexedDB and ES modules; minimum Android API alone does not prove WebView compatibility.
- APK Signature Scheme v2 verification: PASS. One RSA-2048 Android Debug certificate, SHA-256 `db2e97055df49ca6cf1780c26f15139e813d82a35d807dbaeb01d88fea7d1058`.
- Debug signing key is workspace-local, outside the source tree and APK. It must not be included in the handoff archive or uploaded. No production key was created/imported.
- Exact bundled asset-manifest SHA-256: `3f8bf3e35a4cf4f5a028a7e8bf96f9546d0a9bee7deb19404c903adc2bc040f9`.
- Stable private WebView origin: `https://localhost`. Changing package ID, signer or origin can affect updates/storage; do not change these after saves without a tested migration. Browser/HTML saves are not automatically available in this app.

## Historical — Actual checks

| Check | Result | Evidence scope |
|---|---|---|
| Complete Node project tests | PASS | 219/219, including 17 Android-adapter/preflight/static tests |
| Read-only release-gate tests | PASS | 37/37; gate/profile unchanged |
| Offline asset build, copy and source hash verification | PASS | All 26 bundled files match exact source; no legacy shared iframe |
| Native source independent review | PASS | Payload saved-state, Back readiness and isolated provider I/O fixes reviewed; runtime not implied |
| `:app:assembleDebug` | PASS | Exit 0, 53 tasks, 2 minutes 53 seconds; app and Capacitor Java compiled, packaged and debug-signed |
| Actual APK manifest, permissions, signature and asset inspection | PASS | Decoded binary manifest, verified v2 signature, exact embedded asset/config hashes; zip alignment independently checked |
| Android runtime startup/CSP bridge | BLOCKED | No supported device/emulator available |
| Keyboard, Back, safe areas, lifecycle, persistence/update and SAF roundtrip | BLOCKED | Requires native runtime tests; JS mocks and static checks do not substitute |
| Android lint | FAIL | 1 error and 7 warnings; source camera-permission removal guard misread as a request. Binary has no camera permission; details below. |
| Phone installation / public distribution | NOT_APPLICABLE | Neither performed |

The packaged sanitized build receipt and inspection outputs are in `evidence/mobile/`; original build receipts remain in the isolated workspace. The build receipt binds the APK, signer, toolchain, actual manifest, known source inputs and embedded asset manifest. It contains no signing key or password.

The existing read-only release gate still permits only its `local-review` target. No web-only manifest or local PASS grants an Android production/distribution target or owner acceptance. A new build/source/config change requires fresh hashes and review.

## Historical — Actual manifest and privacy behavior

- The APK requests exactly **one app-scoped signature-level permission**, `app.cashweave.offline.trial.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`, added by AndroidX. It does not request Internet, network-state, camera, broad storage or media permissions. Do not describe it as a zero-permission APK.
- Exported components: launcher `MainActivity`; AndroidX `ProfileInstallReceiver`, protected by `android.permission.DUMP`. AndroidX `InitializationProvider` is not exported. Do not claim the launcher is the sole exported component.
- Actual `allowBackup=false`, `fullBackupContent=false`, `usesCleartextTraffic=false`. Compiled extraction rules exclude all listed application domains from cloud backup and device transfer. OEM runtime behavior still requires verification; manual backups are essential.
- APK is `debuggable=true` at OS level. Capacitor logging and WebView debugging are disabled in app configuration/code. Synthetic data only.
- No account, backend, paid service, bank integration, remote server, public deployment or online synchronization is introduced. No financial core was changed.
- Native HTTP/cookie patching and mixed content are disabled. No remote navigation allowlist.
- CSP is `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src 'none'; connect-src 'none'; form-action 'none'; object-src 'none'; base-uri 'none'`. Inline style support serves existing DOM/inset styling; scripts do not allow arbitrary inline code or eval.
- Pinned Capacitor 8.5.3 inserts its trusted native bridge immediately after literal `<head>`, before meta CSP. Static source/hash verification guards this ordering. This is not proof of real WebView behavior; changing Capacitor/head structure requires new runtime testing.

## Historical — Backup and lifecycle behavior

The first-party `LocalBackup` plugin uses user-driven Android document pickers with `EXTRA_LOCAL_ONLY`. No third-party filesystem/share plugin, broad storage permission or persistent URI grant is used. A document provider is a separate app; the local-only flag is not a cryptographic guarantee against a faulty provider. Choose device storage.

- JSON is plaintext. Keep files private and use fictional data during this trial.
- Export text is removed from Capacitor call options before the picker. Payload stays in transient memory, never Android saved state, logs, preferences or app-private payload files. A small persisted boolean contains no financial data, filename or URI and supports interruption reporting after process death.
- Export success occurs only after stream close. Failure/cancel/interruption is visible, and there is no unreliable blob-download fallback. Interruption may leave an empty, partial or fully written file; verify it before use.
- Provider I/O has its own executor. A 30-second user-facing deadline rejects an operation exactly once. Cancellation, interruption and close are cooperative: a pathological provider may keep that executor blocked, and retries may time out until app process restart. The timeout does not guarantee provider termination.
- Import is bounded to 5 MiB during streaming, decodes UTF-8 strictly, and passes unchanged text to existing staged validation. Choosing a file does not activate data. Recreated picker results never automatically write, read or activate a restore.
- Native Back backgrounds safely before JS readiness. Once ready, each Back request has an acknowledgement and a 1.5-second unacknowledged fallback. Acknowledged requests preserve the app's existing filter/pending-write/navigation decisions.
- Uninstalling or clearing app data deletes local saves. Keep and verify an explicit JSON backup before updates/reinstalls. Same package ID alone does not prove update compatibility.

## Historical — Verified toolchain and agreements

All downloads/caches/tooling and the debug signer stayed inside the isolated workspace. Official archives were SHA-256 verified before execution:

| Component | Actual version / checksum |
|---|---|
| Node | 24.19.0 |
| Capacitor core / Android / CLI | 8.5.3, pinned in npm lockfile |
| Full Eclipse Temurin JDK/javac | 21.0.12.1+1; archive SHA-256 `ce79869e1307ed8ee1e2baa86a412b1eb5b75d10a01006d788a6f968bcfaee94` |
| Gradle | 8.14.3; archive SHA-256 `bd71102213493060956ec229d946beee57158dbd89d0e62b91bca0fa2c5f3531` |
| Android Gradle Plugin | 8.13.0 |
| Android command-line tools | 22.0, build 15859902; archive SHA-256 `4e4c464f145a7512b57d088ac6c278c03c9eea610886b35a5e0804e74eedf583` |
| Android platform | android-36, revision 2 |
| Build tools | App 36.0.0; Capacitor library also required 35.0.0 |
| Platform tools / adb | 37.0.1 |

The initial environment had only a Java runtime. Preflight now checks `javac` 21 too; its regression test rejects a JRE-only or wrong-compiler setup.

The user approved official tooling and the [current linked Android SDK agreement](https://developer.android.com/studio/terms). The command-line tools were downloaded/run under that approval. The packages separately presented `android-sdk-license` dated January 16, 2019 from the [official repository XML](https://dl.google.com/android/repository/repository2-4.xml). Its exact text was supplied to and specifically approved by the user before acceptance.

That exact package agreement, SHA-256 `1f8729233617b193fd619213792ae16a41b95d2bbbf525dfe66998252ba68b16`, was accepted at **2026-10-10T02:03:51.614368Z**, by one affirmative response after hash and displayed-text matching. No unrelated agreement was accepted. Build-Tools 35 subsequently used the same accepted agreement. See `evidence/mobile/sdk-license-acceptance.json` for the dated receipt.

The downloaded JDK initially did not recognize the environment proxy's certificate chain. A checked, process-only setting used the existing installed system-JRE CA truststore, retaining certificate and hostname validation and the provided proxy. No new certificate was imported, no system trust setting changed, and no network bypass/mirror was used.

Some initial install/configuration/build attempts were cancelled during automatic approval review. They were not bypassed; the explicitly authorized identical retries succeeded. Nonfatal build warnings concerned SDK XML v4/v3 metadata compatibility, redundant manifest permission-removal guards, upstream unchecked Java operations and Gradle deprecations. These do not substitute for native smoke tests.

## Historical — Build procedure is archived, not executable handoff guidance

The old isolated checkpoint used its then-approved tool/cache/proxy/SDK/signing setup and a two-worker native build. Those commands are intentionally omitted from this source handoff: they are not the current Windows/resource plan and could generate a different debug key if replayed. Do not recreate, import or change a signer for convenience. Do not copy historical HOME/proxy/trust settings, download tools or accept agreements on the strength of this archive.

For the current source, use the README's conditional development setup and project release runbook. Native execution remains BLOCKED pending exact toolchain/dependency/signing evidence, resource/supervision review and authorization. Any future plan must keep lint abortOnError and the current memory guard, run lint then assemble sequentially with fresh preflight at each step, and obtain exact APK review before any installation. No executable native command is granted by this historical document. Changing package/signer/origin or uninstalling to bypass update failure is not permitted.

## Historical — Required native smoke before treating the trial as ready

No supported Android runtime was available here. `/dev/kvm` is absent; the current documented software-emulation override is unsupported and was not enabled. No large emulator image, experimental override, browser-localhost workaround, phone installation or security-setting change was used.

Record device model, OS/WebView versions, APK hash, signer and source/asset identity, using only fictional data:

1. Cold launch in airplane mode. Verify native bridge/CSP and IndexedDB startup.
2. Check 360/390/412 CSS-pixel-equivalent widths, font scaling, safe areas, keyboard resize, navigation reachability and scrolling.
3. Create a synthetic book and transactions; kill/relaunch and compare IDs/counts/balances.
4. Confirm Back closes filters, protects pending writes, navigates and backgrounds at root; exercise startup/import failure paths.
5. Export locally, cancel once, retry, verify exact file bytes/checksum; test unavailable/unwritable/stalled provider paths without false success.
6. Restore through preview/explicit activation, reconcile, then rollback. Corrupt, future-version, cancelled and oversized files must not replace active data.
7. Rotate/background during picker/I/O and force process recreation. Verify visible interruption warning, no duplicate money writes and no automatic write/restore after recreation.
8. Update in place with same identity/signer and a higher version code; compare saves. Same-source relaunch is not upgrade testing.

Unrun items remain BLOCKED. Do not use real financial data until native recovery and lifecycle behavior are verified.

## Historical — Final lint addendum

`:app:lintDebug` ran after the APK was frozen, exit 1 with 1 error and 7 warnings. The sole error, `PermissionImpliesUnsupportedChromeOsHardware`, points to `CAMERA tools:node="remove"`. Binary inspection confirms the permission is absent, so this is assessed as a source-lint false positive, not an actual camera request. Storage-removal guards produce two similar warnings. Other warnings concern two deliberate synchronous interruption-marker writes, redundant/unused metadata and a newer AndroidX Activity version. No lint suppression, dependency update or app-source change was made. All 43 known build inputs and the APK hash remain unchanged. See `evidence/mobile/android-lint-addendum.json` and the accompanying reports; lint is **FAIL**, not PASS. Runtime remains BLOCKED.
