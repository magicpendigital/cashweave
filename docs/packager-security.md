# Packager source CashWeave — ứng viên sửa P1

Trạng thái: **chờ Linh review độc lập; chưa dùng để đóng gói source bàn giao thật**. Chỉ test fixture giả đã được phép. Đây là bộ đóng gói source offline, không cấp quyền release hoặc gửi ZIP ra bên ngoài.

## Contract

`scripts/package-mobile-review.py` không duyệt root hoặc sibling folder. Caller cung cấp một staging root bất biến, một allowlist JSON đã review, SHA-256 của chính file allowlist đó và một output ZIP mới nằm ngoài source root. Allowlist nằm trong cùng directory đã chọn cho output; directory phải tồn tại, là local Windows directory không có symlink/junction/reparse. Không chạy trên UNC/network drive hoặc nền tảng chưa kiểm handle transaction.

JSON UTF-8 không BOM, đúng ba key, không key trùng:

```json
{
  "schemaVersion": 1,
  "snapshotId": "synthetic-example",
  "files": [
    {"path": "app.js", "bytes": 23, "sha256": "<64 lowercase hexadecimal characters>"}
  ]
}
```

SHA-256 mong đợi phải đến từ allowlist được reviewer kiểm; tự tính lại hash không tạo ra phê duyệt của con người. Manifest chỉ bind path/length/hash, không chứng minh payload của một source file hợp lệ không chứa secret. Aggregate manifest cũ không được tái dùng trực tiếp; phải chuẩn bị inventory curated đúng contract và qua Linh.

Kiểm toàn bộ danh sách path, schema, collision và blocklist trước khi stat/open/hash bất kỳ source input nào. Path tương đối canonical, không absolute/traversal/backslash/ADS/control/Windows reserved name, không Unicode khác NFC, không duplicate/case collision. Lstat explicit ancestors, kiểm reparse flag, physical identity, hardlink count và actual opened-handle path trước khi đọc. Không đọc file ngoài allowlist.

Blocklist phụ so case-insensitive: directory documents/data/private/backups/saves/userdata/.aws/.codex/.ssh/.git/cache/build/node_modules; .env và credential/machine-config names; database/WAL/SHM; signing/private key; APK/AAB/archive/raw log và private backup JSON. Không có wildcard exception cho dependency hay evidence. Native dependencies/APK và sanitized evidence cần workflow/artifact riêng; một file bị policy chặn không được bỏ chặn chỉ vì có trong allowlist.

Giới hạn: manifest <=1 MiB, mỗi file <=16 MiB, tổng source <=64 MiB, tối đa 4.096 record; số handle thực tế còn bị OS/runtime giới hạn, thiếu handle/quyền phải FAIL. Stream 64 KiB, ZIP_STORED tránh tải nén/RAM lớn. Windows input handles giữ share-read only; directory handles không share-delete. Manifest và source handles giữ tới cuối transaction. Kiểm hash khi copy và đọc lại từ handle trước publish; kiểm exact ZIP inventory/hash từng entry qua chính handle partial, không reopen staging path.

Partial tạo CREATE_NEW, giữ write/delete handle riêng và không share-write/delete. Publish dùng `SetFileInformationByHandle(FileRenameInfo)` với ReplaceIfExists FALSE. Cleanup thất bại dùng FileDispositionInfo trên handle của chính partial, không unlink một path có thể đã bị thay thế. Không có fallback overwrite/copy, không mở/xóa output cũ, không xóa/reset input. File system/API/quyền không hỗ trợ thì FAIL và báo lỗi, không đổi security.

Tham chiếu: [Microsoft FILE_RENAME_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_rename_info) mô tả lỗi khi target tồn tại và ReplaceIfExists FALSE; [Python stat_result](https://docs.python.org/3/library/os.html#os.stat_result) mô tả st_ctime Windows deprecated. Identity Windows dùng file ID, size, mtime/birthtime và SHA-256; Linux/macOS chưa được chứng nhận, CLI hiện từ chối ngoài Windows.

## Test nhẹ với dữ liệu giả

```powershell
$env:CASHWEAVE_PACKAGER_FIXTURE_DIR = '<writable fixture directory>'
& '<existing Python executable>' -B tests/packager_security_test.py
```

Fixture directory phải là nơi được phép ghi. Tests giữ fixture giả để reviewer kiểm, không dùng project thật làm input. Test tạo junction/hardlink có thể cần approval runtime thông thường khi sandbox chặn; không thay cấu hình OS. Bộ test có read-spy và kiểm trước-read, không discovery; private/DB/key/secret case variants; traversal/collision; junction/hardlink/symlink/reparse; outside-handle; hash/missing/drift/bytes đổi giữ mtime; input/partial/directory locks; output existing/race; interrupted write; archive inventory mismatch; CLI fixture. File symlink kiểm bằng injected metadata, junction/hardlink kiểm thật trên Windows.

Sau Linh PASS và parent cho phép dùng source thật, CLI cần bốn tham số explicit: `--root`, `--manifest`, `--manifest-sha256`, `--output`. Kết quả luôn `releaseAuthorized=false`. Không auto-create allowlist bằng quét project, không tự sửa release profile, không upload/sign/install.
