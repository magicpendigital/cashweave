# Kế hoạch QC có thể chạy lại

Cập nhật 20/10/2026. Dùng dữ liệu giả và origin/profile cô lập; giữ nguyên dữ liệu thật. QA và review độc lập phải kiểm source cuối cùng, không dùng kết quả lịch sử để cấp PASS cho code mới.

## Chạy QC cục bộ

```powershell
node scripts/qc.mjs --out evidence/qc-local/current.json
```

Orchestrator chạy tuần tự: build review hai generation, toàn `tests/*.test.mjs`, release-gate fixtures, Python packager security, browser IndexedDB, build mobile web một lần, copy/verify assets Android/iOS và kiểm tool availability. Các static native tests đã nằm trong full Node suite, không chạy trùng riêng. Các bước thiếu dependency/toolchain ghi BLOCKED; các bước độc lập vẫn chạy. Không install dependency, chấp nhận license, compile/sign/install/upload hay gọi dịch vụ.

Receipt có exact input inventory/digest trước-sau, lệnh/exit thực, môi trường, thời gian và log hash. Đầu vào thay trong bước làm bước đó BLOCKED; đầu vào thay trong toàn run làm run BLOCKED. Đây là `LocalQcExecution`, không phải receipt release được tự cấp owner approval. Full `npm test` tương đương review build + Node suite; release/Python/browser/native vẫn là cổng riêng.

Exit orchestrator hiện hành: 1 có FAIL; 2 còn BLOCKED. Native build, device/UAT/accessibility và store acceptance luôn được liệt kê BLOCKED vì không được lệnh này thực thi; đánh giá bằng hồ sơ riêng, không sửa receipt cũ thành PASS. Vì vậy code/static PASS không khiến quyết định phát hành tự động PASS. Có thể đọc từng step receipt để biết phần nào đã thực sự chạy.

GitHub workflow chỉ có `workflow_dispatch`, không trigger push/PR, không deploy/ký/cài thiết bị, không đọc secrets. Runner chuẩn bị dependency theo lockfile bằng `npm ci --ignore-scripts --no-audit --no-fund` trước khi chạy orchestrator; không tải SDK/Gradle hay chấp nhận SDK license. Nó chưa được push/chạy remote. Native/toolchain/device còn thiếu vẫn BLOCKED; không biến việc chuẩn bị Node dependency thành native PASS.

## Các lớp kiểm chứng

| Lớp | Đầu vào/chạy | Điều kiện đạt |
|---|---|---|
| Domain | `tests/schema3.test.mjs`, `domain-remediation.test.mjs` và regression | Tiền nguyên/conservation, undo/correction, settlement/cutoff, opening, recurrence, template |
| Legacy/compatibility | Ledger/storage/budgeting/UI tests | Giữ thẻ/tài sản/CSV, backup/restore đúng model, không bỏ field chưa ánh xạ |
| Restore/migration | `persistence-remediation.test.mjs` | v1/v2 envelope/direct, explicit dates/ack, counts/số dư, corrupt/future/namespace; lỗi giữ raw |
| Transaction/recovery | Browser IndexedDB thật | Concurrent retry, abort, revision, stage generation, reopen rollback, same-file re-restore, corrupt-active recovery |
| Capture lệnh | `command-capture.test.mjs` và browser IDB | Đóng băng lệnh/snapshot trước hash, capture trước queue/read; receipt khớp tiền đã lưu; chặn command ABA; notification lỗi không báo commit thất bại |
| Sổ chung | Shared domain/persistence/UI tests và browser shared scenarios | Sổ riêng, VND, đóng góp/chi/ứng/hoàn, correction/void, thỏa thuận/chốt kỳ, File preview/ack, reopen/rollback, no-lock read-only, raw recovery; A/B không phải xác thực |
| Kho lỗi duy nhất | Personal/shared emergency IDB + actual browser form | Corrupt/future/non-JSON/missing/malformed head; không auto-seed, đủ xác nhận, CAS/stale/abort, backup hợp lệ phục hồi và raw cũ còn sau reopen |
| Multipart | Fixture Unicode >5 MiB | Mỗi phần ≤5 MiB; complete/reordered roundtrip; missing/duplicate/mismatch/corrupt/size không stage; archive-only không activate |
| UI harness | `next-*.test.mjs`, legacy harness | Luồng submit/negative path; VM/DOM harness không chứng minh layout/browser/native |
| Packaging security | `python -m unittest discover -s tests -p packager_security_test.py` | Fixture path/handle/hash/allowlist/ZIP privacy, không đóng gói real data |
| Release checker | `node --test scripts/release-evidence.test.mjs` | Logic immutable evidence/target/approval; fixture PASS không cấp quyền release |
| Mobile source/assets | Build/sync/verifier + static tests | Graph/hash/CSP/origin/bridge contracts/source target; không suy ra compile hoặc device PASS |
| Native/device | [matrix](native-device-qa.vi.md) | Exact artifact, toolchain, thiết bị, lifecycle/recovery/update, human UAT |

Mỗi defect ghi expected/actual, input giả, môi trường, source/input digest, command và PASS/FAIL/BLOCKED. Test phải tái hiện hành vi lỗi, không chỉ lặp nội bộ implementation. Negative path phải so snapshot trước/sau và chứng minh không có commit/receipt/posting một phần.

## Hiệu năng và nghiệm thu cuối

```powershell
node scripts/benchmark-synthetic.mjs --sizes 10000,100000 --timeout-ms 30000
```

Benchmark tạo dữ liệu giả trong RAM, chỉ đo read/report/serialization, không đọc/ghi DB hoặc save thật; JSON stdout ghi engine, số bản ghi, source hash, thời gian, bộ nhớ và phép đối soát. Có timeout cho từng fixture. Ngưỡng UX như report <1 giây/cold launch <3 giây là **đề xuất để thảo luận**, chưa là acceptance. Host Node 100k không thay benchmark thiết bị Android yếu/iOS WKWebView; giới hạn kích thước backup có thể thấp hơn số dòng model cho phép.

Đóng cổng chỉ sau kiểm tra visual/touch/keyboard/safe area/font scaling/screen reader, process death, quota/disk-full, native file-provider cancel/interruption, update giữ dữ liệu, exact signature/manifest/dependency và privacy/store packet. Reviewer độc lập ký nhận phạm vi bằng chứng; chủ dự án duyệt đúng candidate/target/hash theo runbook. Không có khẳng định “không còn bất cứ lỗi nào”.
