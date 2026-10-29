# Kế hoạch phát triển CashWeave theo thiết kế mới — Đợt 1

*Ngày lập: 29/10/2026 · Nhánh: `claude/cashweave-analysis-redesign-d447b8` · Cơ sở: [báo cáo phân tích](ANALYSIS-REDESIGN-2026-10-27.vi.md) và canvas thiết kế 14 màn hình.*

## 1. Mục tiêu đợt 1

Đưa ứng dụng mobile (`next.html` → `ui/`, gói Android offline) sang kiến trúc thông tin và giao diện mới, đồng thời gỡ các nút thắt hiệu năng và rủi ro mất dữ liệu đã đo được. Ứng dụng vẫn **offline hoàn toàn** (theo AGENTS.md); không thêm phụ thuộc cloud, không truyền dữ liệu.

**Điểm xuất phát (đo ngày 29/10):** 222/222 test đạt (sau khi sửa harness test cũ không chịu ký tự CRLF trên Windows). Một lần ghi ở lõi mất 82 ms với 1.000 giao dịch và 226 ms với 2.000 giao dịch. Sao lưu bị chặn ở 5 MB, tương đương khoảng 3.000 giao dịch.

## 2. Phạm vi

| Có trong đợt 1 | Để đợt sau (cần duyệt riêng) |
|---|---|
| IA mới: 5 tab (Trang chủ · Sổ · ＋ · Kế hoạch · Thêm) | SQLite/SQLCipher thay IndexedDB |
| 14 màn hình theo canvas, bộ thuật ngữ mới (Hũ, Phương pháp chia tiền…) | Mã hoá sao lưu bằng mật khẩu (S3) |
| Lõi: bỏ validate thừa, chỉ mục Map, O(n) | Khoá vân tay/PIN, `FLAG_SECURE` (S4) — cần plugin native và build |
| Nâng giới hạn sao lưu 5 MB → 64 MB (S1) | Nén sao lưu (đổi định dạng file) |
| Thư viện phương pháp chia tiền + lệnh `applyRecipePreset` | Nhập sao kê CSV cho tài khoản đầu tư |
| Tài khoản đầu tư, định giá thủ công, tổng tài sản | Giá trực tuyến, API sàn (giai đoạn 3) |
| Nhắc sao lưu, Sổ phân trang | iOS (giai đoạn 2), đồng bộ (giai đoạn 3) |

Không sửa: `documents/`, bản v1 (`index.html`, `app.js`, `couples*`), quy trình release và cấu hình ký Android.

## 3. Phân công và quyền sở hữu tệp

Hai luồng chạy song song trên cùng worktree, **tệp không chồng nhau**. Luồng QA chạy sau khi cả hai bàn giao.

| Luồng | Vai trò (theo `agents/`) | Sở hữu tệp | Không được sửa |
|---|---|---|---|
| **A — Lõi & hiệu năng** | prototype-builder (core) | `core/**`, `state-schema.js`, `mobile/backup-bridge.js`, `LocalBackupPlugin.java` (chỉ hằng số giới hạn), test mới `tests/core-*.test.mjs`, `scripts/bench-core.mjs` | `ui/**`, test UI |
| **B — Giao diện mới** | prototype-builder (UI) + product-content | `ui/**` (có thể tách `ui/screens/*.js`), `next.html`, `mobile/native.css`, `tests/next-*.test.mjs`, `tests/next-ui-harness.mjs` | `core/**` |
| **C — Kiểm thử & review độc lập** | software-qa + independent-reviewer | Chỉ thêm test mới `tests/qa-*.test.mjs`; báo lỗi, không sửa mã sản phẩm | mọi tệp sản phẩm |
| **Điều phối** | coordinator | Tệp kế hoạch này, tích hợp, quyết định cổng | — |

## 4. Hợp đồng API giữa luồng A và B

Luồng B lập trình theo hợp đồng này. Luồng A bổ sung chi tiết thực tế vào **mục 4.4** khi hoàn thành.

### 4.1 Phương pháp chia tiền — `core/recipes.js`
- `RECIPE_PRESETS`: mảng đóng băng; mỗi phần tử `{ id, version, name, summary, suitedFor, lines:[{ key, envelopeName, type:'PERCENT'|'FIXED', value }], shortagePolicy, leftoverPolicy, leftoverKey? }`.
  - Mã: `six-jars`, `50-30-20`, `pay-yourself-first`, `zero-based`.
- `presetById(id)`.
- Lệnh `applyRecipePreset` (qua `prepareCommand` như các lệnh khác):
  - Đầu vào: `{ presetId, budgetPoolId, templateName?, lineOverrides?: { [key]: value } }`.
  - Trong một lệnh atomic: ghép hũ có sẵn theo tên (không phân biệt hoa thường, chưa lưu trữ) hoặc tạo hũ còn thiếu.
  - Lưu phiên bản mẫu kèm `presetId`/`presetVersion`.
  - Kết quả trả về id của mẫu và của các hũ.
- Mẫu tự tạo dùng lệnh `saveTemplate` hiện có, không đổi.

### 4.2 Tài sản đầu tư
- Loại tài khoản mới:
  - `INVESTMENT`: mặc định `includeInBudget=false`.
  - `E_WALLET`.
- Collection mới `valuations`:
  - Bản ghi: `{ accountId, date, valueMinor, lines?:[{ symbol, quantity, unitPriceMinor }], note? }`.
  - `quantity` là chuỗi thập phân. Không sinh bút toán.
- Lệnh `recordValuation`:
  - Đầu vào: `{ accountId, date, valueMinor? , lines? }`. Có `lines` thì tổng được tính từ `lines`, làm tròn về đơn vị nhỏ nhất, tiền VND.
- `netWorth(snapshot, { date, staleDays = 7 })` trong `core/reports.js` hoặc `core/networth.js`:
  - Trả về `{ totalMinor, spendableMinor, groups:[{ type, totalMinor }], accounts:[{ accountId, valueMinor, valuedAt|null, stale }] }`.
  - Tài khoản thường lấy số dư sổ. Tài khoản đầu tư lấy định giá gần nhất ≤ `date`, nếu chưa có thì lấy số dư sổ.
- Snapshot cũ không có `valuations` vẫn mở, khôi phục và xuất được. Cần test chứng minh.

### 4.3 Sao lưu
- `MAX_BACKUP_BYTES` = 64 MB, thống nhất ở `core/migration.js`, `mobile/backup-bridge.js` và `LocalBackupPlugin.MAX_BYTES`.

### 4.4 Ghi chú thực hiện của luồng A
*Đã giao (2026-10-29). Mọi lệnh chạy qua `repo.runAtomicCommand({commandId,type,input}, revision)`; `commandId`/receipt chống ghi trùng như cũ.*

**Phương pháp chia tiền — `core/recipes.js`**
- `RECIPE_PRESETS` (đóng băng sâu). Phần tử: `{ id, version:1, name, summary, suitedFor, fixedScope, shortagePolicy, leftoverPolicy, leftoverKey?, leftoverEnvelopeName?, lines:[{ key, envelopeName, type, value }] }`.
  - `value` của `PERCENT` là **basis point** (5500 = 55%); của `FIXED` là chuỗi đơn vị nhỏ nhất (`'0'` mặc định ở `zero-based`).
  - `zero-based`: `leftoverKey:'buffer'`, `leftoverEnvelopeName:'Dự phòng'`, `fixedScope:'CALENDAR_MONTH'`; ba bộ còn lại `PER_APPLICATION`.
- `presetById(id)` → preset hoặc `null`. `requirePreset(id)` ném `UNKNOWN_RECIPE_PRESET`.
- `previewRecipe(presetId, amountMinor, { lineOverrides })` → kết quả `calculateAllocation` (không cần dữ liệu), mỗi dòng thêm `key`, `envelopeName`. Dùng cho màn hình xem trước trước khi áp.
- Lệnh `applyRecipePreset`, input `{ presetId, budgetPoolId, templateName?, templateId?, fixedScope?, lineOverrides?: { [key]: value } }`.
  - Ghép hũ chưa lưu trữ cùng pool theo tên (trim, NFC, không phân biệt hoa thường `vi-VN`); thiếu thì tạo.
  - Áp lại cùng preset (không truyền `templateId`) thì thêm **phiên bản mới** vào mẫu đã tạo trước đó, không tạo mẫu/hũ trùng. `stableLineKey = '<presetId>:<key>'`.
  - Phiên bản mẫu có thêm `presetId`, `presetVersion`.
  - `resultIds = [templateId, templateVersionId, ...envelopeIds]` (theo thứ tự dòng, hũ dư nếu có ở cuối).
  - Lỗi mới: `UNKNOWN_RECIPE_PRESET`, `UNKNOWN_RECIPE_LINE`, `INVALID_RECIPE_OVERRIDES`; lỗi mẫu cũ giữ nguyên (`PERCENT_OVER_100`, `INVALID_PERCENT_LINE`, `TEMPLATE_ARCHIVED`, …).

**Tài sản đầu tư**
- `ACCOUNT_TYPES = ['CASH','BANK','E_WALLET','INVESTMENT']` (`core/model.js`). `addAccount` với `INVESTMENT` mặc định `includeInBudget=false` (chỉ `true` khi truyền rõ), nên không tạo nguồn thu và không đổi "Chưa có mục đích".
- Collection `valuations`, bản ghi `{ accountId, currencyCode, date, valueMinor, lines?:[{ symbol, quantity, unitPriceMinor, valueMinor }], note, createdByCommandId }`. Không sinh bút toán.
- Lệnh `recordValuation`, input `{ accountId, date, valueMinor?, lines?, note? }`.
  - Chỉ cho tài khoản `INVESTMENT` chưa lưu trữ. Ngày không ở tương lai.
  - Có `lines` thì mỗi dòng = `quantity × unitPriceMinor` làm tròn nửa lên về đơn vị nhỏ nhất (BigInt), tổng = Σ dòng. Truyền cả `valueMinor` thì phải khớp.
  - `quantity`: chuỗi thập phân không âm, tối đa 12 chữ số lẻ. Hàm thuần `valuationLine({symbol,quantity,unitPriceMinor})`.
  - Lỗi: `VALUATION_REQUIRES_INVESTMENT_ACCOUNT`, `VALUATION_DATE_IN_FUTURE`, `VALUATION_VALUE_REQUIRED`, `VALUATION_TOTAL_MISMATCH`, `INVALID_VALUATION_AMOUNT`, `INVALID_VALUATION_LINES`, `INVALID_VALUATION_LINE`, `INVALID_VALUATION_QUANTITY`, `INVALID_VALUATION_PRICE`; `validateSnapshot` ném `INVALID_VALUATION`.
- `netWorth(snapshot, { date = hôm nay, staleDays = 7, currencyCode = tiền mặc định })` trong `core/reports.js`.
  - Trả `{ date, currencyCode, staleDays, totalMinor, spendableMinor, groups:[{type,totalMinor}], accounts:[{ accountId, type, name, archived, includeInBudget, valueMinor, ledgerMinor, valuedAt|null, valuationId|null, stale }], revision }`.
  - Chỉ tính tài khoản cùng `currencyCode`. Số dư sổ tính đến hết `date`. `spendableMinor` = mọi loại trừ `INVESTMENT`.
  - `stale = true` khi tài khoản đầu tư chưa có định giá hoặc định giá mới nhất cũ hơn `staleDays` ngày. Cùng ngày thì bản ghi sau thắng.
  - Lỗi: `INVALID_STALE_DAYS`, `INVALID_LOCAL_DATE`.
- Tương thích: `valuations` là collection tùy chọn (`OPTIONAL_COLLECTIONS`). Snapshot/bản sao thiếu khóa này vẫn hợp lệ; repository, khôi phục và lần ghi đầu tự thêm `valuations: []`. Màn hình nên đọc qua `items(state,'valuations')` hoặc `state.valuations ?? []`.

**Sao lưu**: `MAX_BACKUP_BYTES = 64 MiB` ở `core/migration.js` (đã export), `mobile/backup-bridge.js`, `LocalBackupPlugin.MAX_BYTES`. Thông báo native đổi thành "64 MiB". `ui/app.js` vẫn chặn tệp khôi phục ở `5*1024*1024`, nên luồng B cần đổi sang dùng `MAX_BACKUP_BYTES`. `state-schema.js`/`storage.js` cũ (localStorage v2) giữ 5 MiB.

**Hiệu năng / thay đổi nội bộ**
- `validateSnapshot` giữ nguyên hành vi và mã lỗi. Thay đổi bên trong: chỉ mục `Map`, O(n); kiểm tra xuất được không dựng chuỗi; ghi nhớ ngày/UTC hợp lệ.
- Repository truyền `VALIDATED_SNAPSHOT` (Symbol export từ `core/commands.js`) nên mỗi lần ghi chỉ kiểm tra đầy đủ **một lần** sau lệnh. Ở chế độ này bản ghi được chia sẻ copy-on-write với snapshot trước. Lệnh mới phải sửa bản ghi cũ qua `own()`; có test đóng băng bảo vệ.
- `prepareCommand` gọi trực tiếp vẫn kiểm tra đầu vào và clone sâu như cũ. `readSnapshot` của IndexedDB bỏ clone thừa.
- Giao diện **không cần** gọi `validateSnapshot` sau mỗi lần ghi nữa.
- Không có thay đổi phá vỡ API cũ.

**Sửa/hủy giao dịch chi (luồng "Sửa")**
- Trước đây `reverseOperation`/`replaceOperation` luôn hỏng với khoản chi (`SPEND_CAPACITY_EXCEEDED`); nay đã sửa. Bút toán đảo (`reversesPostingId`) có sức chứa liên kết quỹ = 0, không bị coi là chi mới.
- Hủy khoản chi đã gắn quỹ: liên kết quỹ được đảo cùng ngày hủy, số dư hũ trả lại.
- `replaceOperation` với khoản chi nhận thêm `spendLinks?: [{ envelopeId, amountMinor }]` (tùy chọn, `[]` để bỏ gắn quỹ).
  - Nếu không truyền: khoản cũ gắn trọn một hũ thì khoản mới gắn trọn số tiền mới vào hũ đó; gắn một phần thì giữ số đã gắn, tối đa bằng số tiền mới. Chuyển sang tài khoản ngoài ngân sách thì bỏ gắn.
  - Gắn lại theo đúng quy tắc `linkExpense` sau khi đã trả lại phần cũ. Vượt số dư hũ thì cả lệnh bị từ chối `ENVELOPE_INSUFFICIENT`, dữ liệu không đổi.
  - `resultIds = [reversalOperationId, replacementOperationId, ...spendLinkIds, ...settlementIds]`. Mã lỗi mới: `INVALID_SPEND_LINKS`, `INVALID_SETTLEMENTS`.
- **Ngày của bản sửa (QA-01/QA-04):** `effectiveLocalDate` của `replaceOperation` chỉ là ngày của khoản **mới**.
  - Bút toán đảo được đặt vào **ngày của khoản gốc**, để báo cáo từng kỳ đã phản ánh bản sửa (chuyển 300 từ 02/10 sang 250 ngày 28/09: tháng 9 = 250, tháng 10 = 0).
  - Ngoại lệ: khoản thu có nguồn từng bị phân bổ (rồi hoàn tác) thì đảo vào ngày phân bổ muộn nhất.
  - Liên kết quỹ và liên kết lịch của khoản gốc được trả lại vào `max(ngày liên kết, ngày đảo)`, nên lịch sử gốc tự triệt tiêu. Chuyển sang ngày sớm hơn không còn lỗi `REVERSAL_BEFORE_LINK`.
- `reverseOperation` (hủy thường) **giữ nguyên**: đảo vào ngày người dùng chọn, có nghĩa là hoàn tiền trong kỳ đó.
- **Liên kết lịch (QA-02):** `replaceOperation` mang theo settlement còn hiệu lực sang khoản mới (giới hạn bằng số tiền mới, kể cả khi lịch đã chốt), đặt vào ngày mới và đánh dấu `carriedFromOperationId`.
  - Bỏ settlement nếu tiền tệ của tài khoản mới khác lịch.
  - `settlements?: [{ planOccurrenceId, amountMinor }]` để chọn tay (theo quy tắc `linkSettlement`, lịch phải đang mở); `[]` để bỏ.
- **Giá trị ròng (QA-03):** với tài khoản đầu tư, `valueMinor` = định giá gần nhất ≤ `date` + biến động sổ của tài khoản đó **sau** ngày định giá. Hàng có thêm `sinceValuationMinor`. Cách tính `stale` giữ nguyên.

**Đọc snapshot (F8):** `repo.readsValidated === true` ở cả hai repository. `readSnapshot()` luôn trả snapshot đã qua `validateSnapshot`, nên **giao diện bỏ `validateSnapshot(await repo.readSnapshot())`** (ui/app.js ~86/94/101/138) và dùng thẳng kết quả.
- IndexedDB chỉ kiểm tra đầy đủ khi `datasetId:revision` khác bản mà chính instance đó đã kiểm tra hoặc ghi: lần mở đầu, tab khác ghi, rollback.
- Mỗi lần ghi còn đúng 1 lần kiểm tra đầy đủ. Lúc mở, nhập và khôi phục vẫn kiểm tra đầy đủ.
- `readSnapshot({ revalidate: true })` ép kiểm tra lại.
- Giới hạn: dữ liệu bị sửa ngoài ứng dụng (devtools) mà giữ nguyên revision sẽ không bị phát hiện trong phiên đó; mở lại là phát hiện.

## 5. Yêu cầu chi tiết

### Luồng A — Lõi & hiệu năng
1. **Hiệu năng ghi** (báo cáo phân tích, mục 5.2):
   - Chỉ chạy `validateSnapshot` đầy đủ khi mở kho, nhập hoặc khôi phục.
   - Sau mỗi lệnh chỉ chạy một lần, hoặc kiểm tra bất biến cục bộ.
   - `entity()` dùng chỉ mục `Map`. Dựng chỉ mục cho `reversesPostingId`, settlements và spendLinks để vòng lặp từ O(n²) về O(n).
   - Không nới lỏng bất biến nào. Mọi test hiện có phải đạt.
2. **Mục tiêu số đo** (`scripts/bench-core.mjs`, Node, máy dev):

   | Số giao dịch | Thời gian mỗi lần ghi |
   |---|---|
   | 2.000 | ≤ 30 ms |
   | 10.000 | ≤ 150 ms |

   Thêm test chống thụt lùi với ngưỡng rộng: 2.000 giao dịch phải < 120 ms.
3. Giới hạn sao lưu 64 MB (mục 4.3), kèm test ở `backup-bridge` và `android-wrapper`.
4. Thư viện phương pháp chia tiền và lệnh `applyRecipePreset` (mục 4.1).
   - Test: áp 6 chiếc hũ cho khoản 18.500.000 ₫ ra đúng 55/10/10/10/10/5, tổng bằng khoản thu.
   - Áp hai lần không tạo trùng hũ.
5. Tài sản đầu tư (mục 4.2).
   - Test: tổng tài sản, giá cũ (`stale`), tài khoản đầu tư không làm thay đổi "Chưa có mục đích".
   - Khôi phục được snapshot cũ không có `valuations`.

### Luồng B — Giao diện mới
1. **Bố cục:**
   - Thanh tab dưới 5 mục, nút ＋ ở giữa.
   - Ẩn Sổ chung.
   - Giữ hash route cũ qua `ROUTE_ALIASES` để link cũ không gãy.
2. **Màn hình** theo canvas: Chào mừng, Thiết lập, Trang chủ, Ghi nhanh, Sổ, Kế hoạch›Sắp đến hạn, Kế hoạch›Hũ, Chia vào hũ, Báo cáo, Thêm, Phương pháp chia tiền, Tự tạo phương pháp, Tổng tài sản, Cập nhật giá.
3. **Thuật ngữ:** theo bảng 4.3 của báo cáo phân tích; chuỗi tập trung ở `ui/i18n.js`.
4. **Giữ nguyên chức năng hiện có** và đặt lại vị trí trong IA mới, gồm:
   - sửa/đảo giao dịch, chuyển khoản, danh mục;
   - kế hoạch lặp, "Đã trả", chia vào hũ có xem trước;
   - báo cáo, sao lưu/khôi phục hai bước, chuyển dữ liệu v1, lịch sử.
5. **Hiệu năng UI:**
   - Ghi nhớ kết quả tính số dư, báo cáo và tổng tài sản theo revision của snapshot.
   - Sổ phân trang 50 dòng một lần, có nút "Xem thêm".
   - Không validate lại snapshot trong `perform`; việc đó đã chuyển xuống lõi.
6. **Trải nghiệm:**
   - Cuộn về đầu trang khi chuyển màn hình (lỗi đã ghi nhận).
   - Vùng chạm ≥ 44 px; `aria-current` trên tab.
   - Thẻ nhắc sao lưu dựa trên lần xuất gần nhất.
   - Mục khoá ứng dụng ghi rõ "Sắp có", không giả vờ đã chạy.
7. **Test:** cập nhật `tests/next-*.test.mjs` theo chữ và luồng mới, **không xoá độ phủ**. Mỗi luồng chính có ít nhất một test thực thi.

### Luồng C — QA & review độc lập
- Chạy toàn bộ `npm test`, `node --test scripts/release-evidence.test.mjs` và bench.
- Review diff về: đúng tiền (BigInt, làm tròn), atomic, bất biến của sổ, XSS/innerHTML, CSP, offline, khả năng tiếp cận.
- Viết test bổ sung `tests/qa-*.test.mjs` cho chỗ còn hở.
- Phân loại theo P0 (sai tiền, mất/lộ dữ liệu), P1 (chặn luồng chính), P2, P3.

## 6. Cổng nghiệm thu đợt 1 (R1)

- [ ] `npm test` đạt 100%. Số test không giảm so với mốc 222.
- [ ] Đạt mục tiêu bench ở mục 5, luồng A.
- [ ] Không còn lỗi P0/P1 mở sau QA.
- [ ] Chạy thử trên trình duyệt (`node server.js` → `/next.html`, khung 390 px):
  - thiết lập lần đầu → ghi chi → chia vào hũ bằng 6 chiếc hũ;
  - cập nhật giá → xem tổng tài sản;
  - sao lưu → khôi phục.
  - Không có lỗi console.
- [ ] Không thêm quyền mạng, CSP giữ nguyên, không thêm phụ thuộc npm chạy lúc runtime.
- [ ] `docs/` cập nhật: mục 4.4 và kết quả cổng.

## 7. Rủi ro

| Rủi ro | Cách giảm |
|---|---|
| Hai luồng chạy test cùng lúc trên một worktree, kết quả chập chờn | Mỗi luồng chỉ chạy test của mình; điều phối chạy toàn bộ khi tích hợp |
| Thêm collection làm hỏng khôi phục bản cũ hoặc migration | Mặc định `[]`, có test với snapshot cũ; gặp blocker migration thì dừng và báo |
| Viết lại UI làm mất chức năng ẩn | Danh sách chức năng ở mục 5, luồng B, bước 4; QA đối chiếu với test cũ |
| Sửa `LocalBackupPlugin.java` nhưng không build được trong phiên này | Chỉ đổi hằng số; test tĩnh `android-wrapper` kiểm tra đồng bộ giá trị |

## 8. Kết quả thực hiện

*Cập nhật 29/10/2026 sau QA vòng 2. Chưa commit.*

### 8.1 Cổng R1

| Tiêu chí | Kết quả |
|---|---|
| `npm test` | **286/286 đạt** (mốc 222). `scripts/release-evidence.test.mjs` 37/37 |
| Bench (`scripts/bench-core.mjs`, ghi qua repository) | 2.000 tx: **16,7 ms** (mục tiêu ≤ 30). 10.000 tx: **71 ms** (mục tiêu ≤ 150). Trước đây ≈ 489 ms / 8.578 ms |
| P0/P1 sau QA | 0 mở. QA-01, 04, 05 đã sửa, test `tests/qa-*.test.mjs` đạt |
| Chạy thử trình duyệt (Chromium, 375 px và 1024 px) | Đạt, không lỗi console: tài khoản đầu tư → cập nhật giá (gõ "1.000" × "25.000" ra 25.000.000 ₫, tổng cập nhật ngay khi gõ) → tổng tài sản; ghi chi bằng bàn phím số → sửa số tiền ("Đã sửa"); 6 chiếc hũ; cảnh báo chia vượt → trừ khoản chi vào hũ → "Chưa có mục đích" về 0 |
| Offline/CSP | Không đổi `package.json`, Manifest, CSP, `next.html`; không có API mạng mới trong `ui/`, `core/`, `mobile/` |

### 8.2 Lỗi QA đã xử lý
QA-01 (P1), QA-04 (P0): ngày của bản sửa. QA-05 (P1): số lượng hiểu theo vi-VN. QA-02, 03, 06, F8, F9 (P2). QA-07, F12 (P3). Lỗi chạy thử B1–B3. Riêng câu kiểm tra cuối của QA-04 tự mâu thuẫn với dữ liệu mẫu (khoản thu ngày 01/10 nằm giữa hai mốc so sánh); điều phối đã sửa câu đó theo đúng ý định ban đầu.

### 8.3 Quyết định của điều phối
- **F10:** "Tiền có thể dùng" ở giao diện nghĩa là các tài khoản `includeInBudget` và không phải `INVESTMENT`. `netWorth().spendableMinor` ở lõi nghĩa là mọi tài khoản trừ `INVESTMENT`. Hai số chỉ lệch khi có tài khoản thường đặt ngoài ngân sách, điều mà giao diện chưa cho tạo. Đợt sau sẽ thống nhất.
- **F11 (P3, chấp nhận):** cập nhật giá ghi mỗi tài khoản một lệnh; nếu ghi lại trong cùng ngày thì bản mới nhất được dùng.
- **Hủy (`reverseOperation`):** vẫn ghi vào ngày người dùng chọn, tức là được hiểu như hoàn tiền trong kỳ đó. **Sửa (`replaceOperation`):** bù trừ ở ngày của giao dịch gốc.

### 8.4 Còn mở (chưa chặn R1)
- **P3:** form "Trừ vào hũ" để trống ô số tiền; nên điền sẵn số tiền của khoản chi.
- **Chưa đo trên thiết bị thật:** chưa bench IndexedDB/WebView trên Android tầm trung. File sao lưu 64 MB cần thử bộ nhớ trên máy thật, vì chuỗi JS UTF-16 và mảng byte bên Java cộng lại có thể tới hàng trăm MB.
- **Chưa build Android:** worktree không có `node_modules/@capacitor/core`. Theo README, việc build/cài đặt cần được duyệt riêng.
- **Ngoài phạm vi đợt 1:** nhập CSV, tỷ giá USDT, khoá ứng dụng, mã hoá sao lưu, SQLite.
