import { summary } from '../couples.js';
import { id } from '../core/identity.js';
import { parseMoney } from '../core/money.js';
import { todayInTimezone } from '../core/calendar.js';
import { prepareSharedExecution } from '../core/shared-schema.js';
import { exportSharedSnapshot, stageSharedRestore, exportSharedRecoveryFiles } from '../core/shared-backup.js';
import { dom } from './dom.js';

// Only parsing/validating the external file gets this origin marker. Repository
// failures remain unwrapped and retain the existing read-only protection.
class SharedBackupInputError extends Error {
  constructor(cause) { super(cause?.message || 'SHARED_INVALID_BACKUP_FORMAT', { cause }); }
}

// Persistence and file access are injected. This view has no personal-store,
// browser-storage, authentication, native bridge or network capability.
export function createSharedOfflineView(document, { repositoryFactory, clock = () => new Date(), onDownload = null, onReadBackup = null, FormData = null, namespace = 'personal' } = {}) {
  const { h, field, input, select, button, table, viewTransition } = dom(document);
  const element = h('section', { class: 'shared-host shared-offline', 'aria-label': 'Sổ chung offline trên thiết bị này' });
  const handlers = new Map(), drafts = new Map();
  let repository = null, state = null, pending = 'opening', readOnly = false, closed = false, unsubscribe = null;
  let route = 'overview', actor = 'A', message = '', isError = false, stage = null, stageExpectation = null, rollbackTarget = null, recoveryRows = [], selectedEntryId = null;
  let entryLimit = 100, billLimit = 100, planLimit = 30, closeLimit = 30, recoveryLimit = 50;
  let month = todayInTimezone('Asia/Ho_Chi_Minh', clock()).slice(0, 7);
  const today = () => todayInTimezone('Asia/Ho_Chi_Minh', clock());
  const hasBook = () => !!state?.space;
  const canWrite = () => !!state && !readOnly && repository?.writable !== false;
  const name = key => state?.names?.[key] ? `${state.names[key]} (${key})` : key;
  const money = value => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(value);
  const acknowledgement = value => value === true || value === 'yes' || value === 'on';
  const entryKinds = [['contribution', 'Góp quỹ'], ['expense', 'Chi từ quỹ'], ['advance', 'Ứng tiền riêng'], ['reimbursement', 'Hoàn ứng từ quỹ']];
  const kindName = entry => entryKinds.find(([kind]) => kind === entry.kind)?.[1] || entry.kind;
  const entryClosed = entry => state.space.closes.some(close => close.status === 'closed' && close.month >= entry.date.slice(0, 7));
  const card = (...children) => h('section', { class: 'card' }, children);
  const note = (text, warning = false) => h('p', { class: 'notice' + (warning ? ' warning' : '') }, text);
  const actions = (...children) => h('div', { class: 'actions' }, children);
  const control = (label, key, type = 'text', value = '', extra = {}, hint = '') => field(label, key, input(key, type, value, extra), hint);
  const checkbox = (key, label) => h('label', { class: 'checkbox', for: key }, input(key, 'checkbox', 'yes', { required: true }), h('span', {}, label));
  const action = (label, fn, primary = false, extra = {}) => button(label, fn, primary, { disabled: !!pending, ...extra });

  function readableError(error) {
    const text = String(error?.message || '');
    if (error instanceof SharedBackupInputError) {
      if (/FUTURE_SCHEMA/.test(text)) return 'Bản sao sổ chung dùng phiên bản mới hơn. Giữ tệp để mở bằng phiên bản hỗ trợ; sổ hiện tại chưa thay đổi.';
      if (/RECOVERY_ARCHIVE/.test(text)) return 'Đây là tệp lưu trữ phục hồi, chưa dùng để kích hoạt trực tiếp. Sổ hiện tại chưa thay đổi; giữ tệp để phục hồi riêng.';
      if (/INVALID_BACKUP_FORMAT/.test(text)) return 'Chọn đúng bản sao sổ chung. Bản sao sổ cá nhân và sổ chung lưu riêng; sổ hiện tại chưa thay đổi.';
      return 'Không xác minh được nội dung bản sao sổ chung. Sổ hiện tại chưa thay đổi; kiểm tra và chọn lại tệp sao lưu đầy đủ.';
    }
    if (/REVISION_CONFLICT|DATASET_CONFLICT|STALE/.test(text)) return 'Sổ đã thay đổi ở một lượt mở khác. Chưa ghi đè dữ liệu; hãy tải lại sổ rồi kiểm tra trước khi thử tiếp.';
    if (/LOCK_UNAVAILABLE/.test(text)) return 'Chưa có khóa ghi an toàn. Sổ được mở chỉ đọc; hãy giữ dữ liệu và dùng môi trường hỗ trợ ghi an toàn.';
    if (/FUTURE_SCHEMA/.test(text)) return 'Bản sao hoặc kho dùng phiên bản mới hơn. Chỉ đọc và xuất bản phục hồi; chưa thay dữ liệu hiện tại.';
    if (/TOO_LARGE/.test(text)) return 'Tệp hoặc thay đổi vượt giới hạn sao lưu an toàn 5 MiB. Dữ liệu đang dùng được giữ nguyên.';
    if (/SHARED_|INVALID_|JOURNAL_|CHECKSUM|STAGE_|BACKUP_/.test(text)) return 'Không xác nhận được dữ liệu hợp lệ hoặc thao tác đã lưu đầy đủ. Dữ liệu cũ được giữ nguyên; hãy tải lại, kiểm tra tệp và thử lại.';
    return text && !/^[A-Z0-9_]+$/.test(text) ? text.slice(0, 300) : 'Chưa hoàn tất thao tác. Hãy giữ dữ liệu và tải lại sổ để kiểm tra.';
  }

  function amount(value, zero = false) {
    let parsed;
    try { parsed = BigInt(parseMoney(String(value), 'VND', 'vi-VN').amountMinor); }
    catch { throw new Error('Nhập số VND nguyên, ví dụ 100.000; không dùng số thập phân.'); }
    if (parsed < (zero ? 0n : 1n) || parsed > 1000000000000n) throw new Error('Số VND phải trong giới hạn từ ' + (zero ? '0' : '1') + ' đến 1.000.000.000.000.');
    return Number(parsed);
  }

  function form(formId, fields, handler, label, { writable = true, disabled = false } = {}) {
    const captureDraft = () => {
      if (!FormData || pending) return;
      drafts.set(formId, Object.fromEntries([...new FormData(node)].filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))));
    };
    const node = h('form', { id: formId, onInput: captureDraft, onChange: captureDraft, onSubmit: async event => {
      event.preventDefault();
      if (!FormData) return;
      const values = Object.fromEntries(new FormData(node));
      await submit(formId, values);
    } }, fields, button(label, () => {}, true, { type: 'submit', disabled: !!pending || disabled || writable && !canWrite() }));
    const draft = drafts.get(formId);
    for (const fieldNode of node.querySelectorAll('[name]')) {
      if (fieldNode.type !== 'file' && draft && Object.hasOwn(draft, fieldNode.name)) {
        if (fieldNode.type === 'checkbox') fieldNode.checked = acknowledgement(draft[fieldNode.name]);
        else fieldNode.value = draft[fieldNode.name];
      }
      if (pending || writable && !canWrite()) fieldNode.disabled = true;
    }
    handlers.set(formId, { handler, node });
    return node;
  }

  async function submit(formId, values) {
    if (closed || pending) return { ok: false, busy: !!pending };
    const registration = handlers.get(formId);
    let ancestor = registration?.node;
    while (ancestor && ancestor !== element) ancestor = ancestor.parentNode;
    if (!registration || ancestor !== element) throw new Error('FORM_NOT_VISIBLE');
    const { handler } = registration;
    const selectedFile = formId === 'shared-import-form' ? element.querySelector('#shared-backup-file')?.files?.[0] : null;
    if (selectedFile) values = { ...values, 'shared-backup-file': selectedFile };
    drafts.set(formId, Object.fromEntries(Object.entries(values).filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))));
    return run('operation', async () => {
      await handler(values);
      drafts.delete(formId);
    });
  }

  async function run(kind, task) {
    if (closed || pending) return { ok: false, busy: !!pending };
    pending = kind; message = 'Đang xử lý. Hãy chờ xác nhận trước khi rời sổ chung.'; isError = false; render();
    try {
      const value = await task();
      return { ok: true, value };
    } catch (error) {
      message = readableError(error); isError = true;
      if (kind === 'write' || !(error instanceof SharedBackupInputError) && /SHARED_REVISION_CONFLICT|SHARED_DATASET_CONFLICT|WRITE_LOCK|JOURNAL|READ_ONLY/.test(String(error?.message))) readOnly = true;
      return { ok: false, error: String(error?.message || '') };
    } finally {
      pending = null;
      if (closed) repository?.close?.(); else render();
    }
  }

  async function execute(type, values = {}) {
    if (!canWrite()) throw new Error('Sổ hiện chỉ đọc. Hãy tải lại và kiểm tra kho dữ liệu trước khi ghi.');
    const expected = state;
    const command = { commandId: id(), type, actor, today: today(), input: values };
    // Reject ordinary input using the same pure domain before persistence. A
    // rejection here is retryable; after calling the repository, a failed or
    // unconfirmed write requires re-reading the authoritative stored state.
    prepareSharedExecution(expected, command, expected.revision, { now: clock().toISOString() });
    try {
      const next = await repository.execute(command, expected.revision);
      if (!next || typeof next.datasetId !== 'string' || !Number.isInteger(next.revision)) throw new Error('SHARED_WRITE_NOT_CONFIRMED');
      state = next; stage = null; stageExpectation = null; rollbackTarget = null;
      message = 'Đã lưu thay đổi vào sổ chung trên thiết bị này.'; isError = false;
    } catch (error) { readOnly = true; throw error; }
  }

  async function readRows() {
    recoveryRows = await repository.listRecoveryDatasets();
  }

  function watchRepository() {
    if (closed || unsubscribe) return;
    unsubscribe = repository.subscribe?.(change => {
      if (closed || pending || change?.datasetId === state?.datasetId && change?.revision === state?.revision) return;
      readOnly = true; message = 'Kho sổ chung đã thay đổi. Hãy tải lại để kiểm tra trước khi ghi tiếp.'; isError = true; render();
    });
  }

  async function refresh() {
    return run('read', async () => {
      stage = null; stageExpectation = null; rollbackTarget = null;
      if (!repository) {
        if (typeof repositoryFactory !== 'function') throw new Error('Chưa có kho sổ chung trên nền tảng này.');
        repository = await repositoryFactory();
      }
      try { state = await repository.readSnapshot(); readOnly = repository.writable === false; }
      catch (error) { state = null; readOnly = true; route = 'data'; await readRows(); throw error; }
      await readRows(); watchRepository(); message = readOnly ? 'Sổ đang mở chỉ đọc vì chưa có khóa ghi an toàn.' : 'Đã tải lại dữ liệu đã lưu.'; isError = readOnly;
    });
  }

  async function go(next) {
    if (closed || pending) return false;
    if (!['overview', 'ledger', 'bills', 'agreement', 'close', 'data', 'help'].includes(next)) return false;
    route = next; rollbackTarget = null;
    if (next === 'data' && repository) await run('read', async () => { await readRows(); message = ''; });
    else render();
    return true;
  }

  function blankBook() {
    return card(h('h3', {}, 'Tạo sổ chung trống'), h('p', {}, 'Sổ này lưu riêng với sổ cá nhân, dùng VND và không có giao dịch mẫu.'),
      form('shared-create-form', [
        control('Tên sổ chung', 'shared-book-name', 'text', '', { required: true, maxlength: 100 }),
        control('Tên hiển thị của người A', 'shared-name-a', 'text', '', { required: true, maxlength: 80 }),
        control('Tên hiển thị của người B', 'shared-name-b', 'text', '', { required: true, maxlength: 80 }),
        checkbox('shared-consent-a', 'Tôi ghi nhận người A đồng ý tham gia và ghi các khoản chung trong sổ này.'),
        checkbox('shared-consent-b', 'Tôi ghi nhận người B đồng ý tham gia và ghi các khoản chung trong sổ này.'),
        checkbox('shared-device-ack', 'Tôi hiểu đây là một sổ trên một thiết bị: ai mở được ứng dụng đều có thể chọn A hoặc B. Nhãn không xác thực danh tính; chưa có PIN, tài khoản hoặc đồng bộ nhiều máy.')
      ], values => {
        if (![values['shared-consent-a'], values['shared-consent-b'], values['shared-device-ack']].every(acknowledgement)) throw new Error('Cần ghi nhận đủ sự đồng ý và giới hạn dùng chung thiết bị trước khi tạo sổ.');
        return execute('create', { name: String(values['shared-book-name'] || '').trim(), names: { A: String(values['shared-name-a'] || '').trim(), B: String(values['shared-name-b'] || '').trim() }, consentA: true, consentB: true, sharedDeviceAck: true });
      }, 'Tạo và lưu sổ chung'));
  }

  function overview() {
    const info = summary(state.space, month);
    return [
      h('div', { class: 'metrics' }, [
        ['Tiền đang ở quỹ', info.cash, 'Số dư cộng dồn đến hết tháng đang xem.'],
        ['Chi chung trong tháng', info.spent, 'Gồm chi quỹ và ứng tiền riêng; hoàn ứng không tính chi lần hai.'],
        ['Còn cần hoàn ứng', Object.values(info.advances).reduce((sum, value) => sum + value, 0), 'Nghĩa vụ cộng dồn đến tháng đang xem.']
      ].map(([label, value, detail]) => h('div', { class: 'metric' }, h('span', {}, label), h('strong', {}, money(value)), h('small', {}, detail)))),
      card(h('h3', {}, 'Phần góp và ứng tiền riêng'), table(['Nhãn ghi nhận', 'Góp trong tháng', 'Còn cần hoàn'], state.space.members.map(member => [name(member), money(info.contributions[member] || 0), money(info.advances[member] || 0)]))),
      card(h('h3', {}, 'Thỏa thuận và mục tiêu'), h('p', {}, info.plan ? `Ngân sách đang áp dụng: ${money(info.budget)}. Còn lại sau chi tháng này: ${money(info.remaining)}.` : 'Chưa có ngân sách được ghi nhận đủ xác nhận của hai nhãn. Không tự chia đều phần góp.'),
        state.space.goal ? h('p', {}, `${state.space.goal.title}: ${money(info.goalAvailable)} sẵn có sau nghĩa vụ hoàn ứng / mục tiêu ${money(state.space.goal.target)}.`) : h('p', {}, 'Chưa đặt mục tiêu chung.'),
        actions(action('Ghi giao dịch', () => go('ledger'), true), action('Hóa đơn và mục tiêu', () => go('bills')), action('Thỏa thuận', () => go('agreement'))))
    ];
  }

  function ledger() {
    const space = state.space;
    const remainingAdvance = advance => advance.amount - space.entries.filter(entry => entry.voided !== true && entry.kind === 'reimbursement' && entry.advanceId === advance.id).reduce((sum, entry) => sum + entry.amount, 0);
    const advances = space.entries.filter(entry => entry.voided !== true && entry.kind === 'advance' && entry.actor === actor && remainingAdvance(entry) > 0);
    const bills = space.bills.filter(bill => bill.amount > space.entries.filter(entry => entry.voided !== true && entry.billId === bill.id).reduce((sum, entry) => sum + entry.amount, 0));
    const entries = space.entries.filter(entry => entry.date.startsWith(month));
    return [card(h('h3', {}, 'Ghi khoản chung · VND'), h('p', {}, `Nhãn đang ghi: ${name(actor)}. Góp quỹ và hoàn ứng là chuyển tiền; chỉ khoản chi hoặc ứng trước được tính vào chi chung.`),
      form('shared-entry-form', [
        field('Loại khoản', 'shared-entry-kind', select('shared-entry-kind', entryKinds, 'contribution')),
        control('Số tiền VND', 'shared-entry-amount', 'text', '', { required: true, inputmode: 'numeric', maxlength: 32 }, 'Ví dụ 100.000, không có phần thập phân.'),
        control('Ngày ghi nhận', 'shared-entry-date', 'date', today(), { required: true, max: today() }),
        control('Ghi chú', 'shared-entry-note', 'text', '', { maxlength: 200 }),
        field('Hóa đơn liên quan', 'shared-entry-bill', select('shared-entry-bill', [['', 'Không gắn hóa đơn'], ...bills.map(bill => [bill.id, `${bill.title} · ${bill.due}`])]), 'Chỉ chọn cho chi từ quỹ hoặc ứng tiền riêng.'),
        field('Khoản ứng được hoàn', 'shared-entry-advance', select('shared-entry-advance', [['', 'Chọn nếu là hoàn ứng'], ...advances.map(advance => [advance.id, `${advance.date} · ${advance.note || 'Ứng tiền riêng'} · còn ${money(remainingAdvance(advance))}`])]), 'Hoàn ứng cần chọn khoản ứng của chính nhãn người nhận hoàn; không gắn hóa đơn lần nữa.')
      ], values => execute('addEntry', { id: id(), kind: values['shared-entry-kind'], amount: amount(values['shared-entry-amount']), date: values['shared-entry-date'], note: values['shared-entry-note'] || '', ...(values['shared-entry-bill'] ? { billId: values['shared-entry-bill'] } : {}), ...(values['shared-entry-advance'] ? { advanceId: values['shared-entry-advance'] } : {}) }), 'Lưu khoản chung')),
      card(h('h3', {}, 'Giao dịch tháng đang xem'), h('p', {}, 'Khoản đã hủy vẫn giữ trong lịch sử, không cộng vào số dư hoặc chi chung.'), entries.length ? table(['Ngày', 'Loại và trạng thái', 'Nhãn', 'Ghi chú', 'Số VND', 'Thao tác'], entries.slice(-entryLimit).reverse().map(entry => [entry.date, (entry.voided ? 'Đã hủy · ' : '') + kindName(entry), name(entry.actor), entry.note, money(entry.amount), action('Xem khoản ' + entry.date + ' · ' + kindName(entry), () => { selectedEntryId = entry.id; route = 'entry'; render(); })]), { mobile: { primary: 1, amount: 4, date: 0, note: 3 } }) : h('p', {}, 'Chưa có khoản ghi trong tháng này.'), entries.length > entryLimit ? action('Xem thêm giao dịch của tháng', () => { entryLimit += 100; render(); }) : null)
    ];
  }

  function entryDetail() {
    const entry = state.space.entries.find(item => item.id === selectedEntryId);
    if (!entry) return card(h('p', {}, 'Khoản này không còn trong sổ đang mở.'), action('Về giao dịch chung', () => go('ledger')));
    const locked = entryClosed(entry), history = (state.space.entryCorrections || []).filter(item => item.entryId === entry.id);
    const bill = state.space.bills.find(item => item.id === entry.billId);
    const snapshotText = value => `${value.date} · ${money(value.amount)} · ${value.voided ? 'đã hủy' : 'đang tính'} · ${value.note || 'Không có ghi chú'}`;
    return [card(h('h3', {}, 'Chi tiết khoản chung'), h('p', {}, `${kindName(entry)} · nhãn gốc ${name(entry.actor)} · ${entry.voided ? 'đã hủy, không tính số liệu' : 'đang tính số liệu'}`), h('p', {}, snapshotText(entry)),
      bill ? h('p', {}, 'Hóa đơn giữ nguyên: ' + bill.title) : null,
      entry.advanceId ? h('p', {}, 'Khoản ứng liên quan giữ nguyên: ' + entry.advanceId) : null,
      h('p', {}, 'Sửa chỉ thay số tiền, ngày và ghi chú. Loại khoản, nhãn gốc và liên kết được giữ nguyên. Nhãn đang chọn chỉ ghi người thực hiện chỉnh sửa; không xác thực danh tính.'),
      locked ? note('Khoản thuộc kỳ đã chốt. Chỉ xem lịch sử, chưa cho sửa hoặc hủy.', true) : form('shared-correct-form', [
        control('Số VND sau sửa', 'shared-correct-amount', 'text', String(entry.amount), { required: true, inputmode: 'numeric', maxlength: 32 }),
        control('Ngày sau sửa', 'shared-correct-date', 'date', entry.date, { required: true, max: today() }),
        control('Ghi chú sau sửa', 'shared-correct-note', 'text', entry.note || '', { maxlength: 200 }),
        control('Lý do sửa', 'shared-correct-reason', 'text', '', { required: true, maxlength: 200 }),
        entry.voided ? checkbox('shared-correct-reactivate', 'Tôi muốn tính lại khoản đã hủy này với số liệu sau sửa, vẫn giữ toàn bộ lịch sử hủy và sửa.') : null
      ], async values => {
        if (entry.voided && !acknowledgement(values['shared-correct-reactivate'])) throw new Error('Cần xác nhận rõ việc tính lại khoản đã hủy.');
        await execute('correctEntry', { id: id(), entryId: entry.id, amount: amount(values['shared-correct-amount']), date: values['shared-correct-date'], note: values['shared-correct-note'] || '', reason: values['shared-correct-reason'] || '', ...(entry.voided ? { reactivate: true } : {}) });
      }, 'Lưu chỉnh sửa có lịch sử'),
      !locked && !entry.voided ? form('shared-void-form', [control('Lý do hủy khoản', 'shared-void-reason', 'text', '', { required: true, maxlength: 200 }), checkbox('shared-void-ack', 'Tôi muốn ngừng tính khoản này, giữ khoản gốc và lý do trong lịch sử. Các liên kết và số dư phải còn hợp lệ.')], async values => {
        if (!acknowledgement(values['shared-void-ack'])) throw new Error('Cần xác nhận rõ trước khi hủy khoản.');
        await execute('voidEntry', { id: id(), entryId: entry.id, reason: values['shared-void-reason'] || '' });
      }, 'Hủy khoản và giữ lịch sử') : null,
      action('Về giao dịch chung', () => go('ledger'))),
      card(h('h3', {}, 'Lịch sử chỉnh sửa và hủy'), history.length ? history.slice().reverse().map(item => h('article', {}, h('h4', {}, `${item.type === 'voidEntry' ? 'Hủy khoản' : 'Sửa khoản'} · ${item.at} · nhãn ${name(item.actor)}`), h('p', {}, 'Lý do: ' + item.reason), h('p', {}, 'Trước: ' + snapshotText(item.before)), h('p', {}, 'Sau: ' + snapshotText(item.after)))) : h('p', {}, 'Chưa có lần sửa hoặc hủy khoản.'))];
  }

  function billsAndGoal() {
    const info = summary(state.space, month);
    return [card(h('h3', {}, 'Hóa đơn chung'), form('shared-bill-form', [control('Tên hóa đơn', 'shared-bill-title', 'text', '', { required: true, maxlength: 200 }), control('Số tiền VND', 'shared-bill-amount', 'text', '', { required: true, inputmode: 'numeric' }), control('Ngày đến hạn', 'shared-bill-due', 'date', today(), { required: true })], values => execute('addBill', { id: id(), title: values['shared-bill-title'], amount: amount(values['shared-bill-amount']), due: values['shared-bill-due'] }), 'Lưu hóa đơn'),
      info.bills.length ? table(['Hóa đơn', 'Đến hạn', 'Đã trả', 'Còn lại'], info.bills.slice(0, billLimit).map(bill => [bill.title, bill.due, money(bill.paid), money(bill.remaining)]), { mobile: { primary: 0, amount: 3, date: 1 } }) : h('p', {}, 'Chưa có hóa đơn đến hạn trong tháng đang xem.'), info.bills.length > billLimit ? action('Xem thêm hóa đơn của tháng', () => { billLimit += 100; render(); }) : null),
      card(h('h3', {}, 'Mục tiêu chung'), form('shared-goal-form', [control('Tên mục tiêu', 'shared-goal-title', 'text', state.space.goal?.title || '', { required: true, maxlength: 200 }), control('Số VND mục tiêu', 'shared-goal-target', 'text', state.space.goal?.target?.toString() || '', { required: true, inputmode: 'numeric' })], values => execute('setGoal', { title: values['shared-goal-title'], target: amount(values['shared-goal-target']) }), 'Lưu mục tiêu'), h('p', {}, 'Tiền sẵn cho mục tiêu đã trừ các khoản ứng còn cần hoàn: ' + money(info.goalAvailable) + '.'))
    ];
  }

  function agreements() {
    const space = state.space, current = today().slice(0, 7);
    const [year, number] = current.split('-').map(Number), next = number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, '0')}`;
    return [card(h('h3', {}, 'Đề xuất ngân sách và phần góp'), h('p', {}, 'Không tự ghi khoản thu/chi từ thỏa thuận. Thay đổi ngân sách đã áp dụng chỉ được bắt đầu ở tháng tương lai.'),
      form('shared-plan-form', [control('Tháng bắt đầu', 'shared-plan-month', 'month', space.plans.some(plan => plan.status === 'active') ? next : current, { required: true }), control('Ngân sách VND', 'shared-plan-budget', 'text', '', { required: true, inputmode: 'numeric' }), field('Cách chia phần góp', 'shared-plan-mode', select('shared-plan-mode', [['ratio', 'Tỷ lệ % · tổng 100'], ['fixed', 'Số VND cố định · tổng bằng ngân sách']], 'ratio')), control('Phần của ' + name('A'), 'shared-plan-a', 'text', '', { required: true, inputmode: 'numeric' }), control('Phần của ' + name('B'), 'shared-plan-b', 'text', '', { required: true, inputmode: 'numeric' }), checkbox('shared-plan-ack', 'Tôi muốn ghi đề xuất theo nhãn đang chọn; người dùng thiết bị cần tự đối chiếu lại trước khi ghi xác nhận cho nhãn còn lại.')], values => {
        if (!acknowledgement(values['shared-plan-ack'])) throw new Error('Cần xác nhận ý định ghi đề xuất.');
        const mode = values['shared-plan-mode'];
        const shares = ['shared-plan-a', 'shared-plan-b'].map(key => mode === 'fixed' ? amount(values[key], true) : /^\d{1,3}$/.test(String(values[key])) ? Number(values[key]) : NaN);
        if (!shares.every(Number.isSafeInteger) || mode === 'ratio' && (shares.some(value => value < 0 || value > 100) || shares[0] + shares[1] !== 100)) throw new Error('Tỷ lệ phải là hai số nguyên không âm và có tổng bằng 100%.');
        return execute('proposePlan', { id: id(), month: values['shared-plan-month'], mode, budget: amount(values['shared-plan-budget']), values: shares });
      }, 'Lưu đề xuất')),
      ...space.plans.slice(-planLimit).reverse().map(plan => card(h('h3', {}, 'Ngân sách từ ' + plan.month), h('p', {}, `${money(plan.budget)} · ${plan.status === 'active' ? 'Đã ghi đủ xác nhận theo nhãn' : 'Đang chờ xác nhận theo nhãn'}`), h('p', {}, `${name('A')}: ${money(plan.expected[0])}; ${name('B')}: ${money(plan.expected[1])}.`), h('p', {}, 'Nhãn đã được ghi nhận: ' + plan.approvals.map(name).join(', ')), plan.status === 'pending' && !plan.approvals.includes(actor) ? form('shared-approve-plan-' + plan.id, [checkbox('shared-plan-confirm-' + plan.id, 'Tôi muốn ghi xác nhận này theo nhãn ' + name(actor) + '.')], values => {
        if (!acknowledgement(values['shared-plan-confirm-' + plan.id])) throw new Error('Cần xác nhận rõ trước khi ghi.');
        return execute('approvePlan', { id: plan.id });
      }, 'Ghi xác nhận của ' + name(actor)) : null)), space.plans.length > planLimit ? action('Xem thêm thỏa thuận', () => { planLimit += 30; render(); }) : null
    ];
  }

  function closing() {
    return [card(h('h3', {}, 'Đối chiếu và chốt kỳ'), h('p', {}, 'Chốt kỳ giữ lịch sử và số dư chuyển tiếp; không ghi thêm thu/chi. Mọi thay đổi số liệu làm bản chốt đang chờ mất hiệu lực.'), form('shared-close-form', [control('Tháng muốn chốt', 'shared-close-month', 'month', month, { required: true, max: today().slice(0, 7) }), checkbox('shared-close-ack', 'Tôi đã xem giao dịch, tiền quỹ và phần ứng còn phải hoàn trước khi đề nghị chốt theo nhãn đang chọn.')], values => {
      if (!acknowledgement(values['shared-close-ack'])) throw new Error('Cần đối chiếu số liệu trước khi đề nghị chốt.');
      return execute('proposeClose', { id: id(), month: values['shared-close-month'] });
    }, 'Lưu đề nghị chốt kỳ')),
    ...state.space.closes.slice(-closeLimit).reverse().map(close => card(h('h3', {}, `Kỳ ${close.month} · ${close.status === 'closed' ? 'đã chốt' : 'đang chờ'}`), h('p', {}, `Tiền quỹ: ${money(close.snapshot.cash)}; chi tháng: ${money(close.snapshot.spent)}.`), h('p', {}, 'Nhãn đã được ghi nhận: ' + close.approvals.map(name).join(', ')), close.status === 'pending' && !close.approvals.includes(actor) ? form('shared-approve-close-' + close.id, [checkbox('shared-close-confirm-' + close.id, 'Tôi muốn ghi xác nhận bản chốt theo nhãn ' + name(actor) + '.')], values => {
      if (!acknowledgement(values['shared-close-confirm-' + close.id])) throw new Error('Cần xác nhận rõ trước khi ghi bản chốt.');
      return execute('approveClose', { id: close.id });
    }, 'Ghi xác nhận của ' + name(actor)) : null)), state.space.closes.length > closeLimit ? action('Xem thêm kỳ chốt', () => { closeLimit += 30; render(); }) : null];
  }

  async function download(text, filename) {
    if (!onDownload) throw new Error('Chưa có bộ lưu tệp trên nền tảng này. Dữ liệu chưa được xuất; hãy giữ nguyên ứng dụng.');
    const result = await onDownload(text, filename);
    if (result?.status === 'cancelled') { message = 'Đã hủy lưu tệp. Chưa xác nhận có bản sao mới.'; return false; }
    if (result?.status === 'requested') { message = 'Đã yêu cầu trình duyệt tải bản sao. Chưa xác nhận tệp đã được lưu; hãy kiểm tra tệp và thử khôi phục trước khi dùng để chuyển thiết bị.'; return false; }
    if (result?.status !== 'written') throw new Error('BACKUP_WRITE_NOT_CONFIRMED');
    message = 'Đã xác nhận lưu bản sao sổ chung. Tệp chứa tên và dữ liệu dạng rõ; hãy giữ riêng tư và thử khôi phục.';
    return true;
  }

  async function downloadRecovery(datasetId) {
    const files = await exportSharedRecoveryFiles(await repository.readRecoverySnapshot(datasetId));
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      if (!await download(file.text, file.name)) {
        if (files.length > 1) message += ` Đang ở phần ${index + 1}/${files.length}; chưa xác nhận lưu đủ các phần. Hãy xuất lại và giữ đủ bộ trước khi chuyển thiết bị.`;
        return;
      }
    }
    message = `Đã xác nhận lưu ${files.length} tệp phục hồi. Đây là kho lưu để kiểm tra, không phải bản sao kích hoạt; cần giữ đủ các phần và bảo vệ dữ liệu dạng rõ.`;
  }

  function dataView() {
    const activeRow = recoveryRows.find(row => row.active);
    const expected = state || activeRow;
    return [note('Sổ chung có bản sao riêng; bản sao sổ cá nhân không chứa dữ liệu này. Tệp JSON là dạng rõ, không có mật khẩu hoặc mã hóa ứng dụng.', true),
      card(h('h3', {}, 'Bản sao sổ chung'), state ? actions(action('Xuất bản sao sổ chung', () => run('file', async () => download(await exportSharedSnapshot(state), `cashweave-shared-${today()}.json`)), true)) : h('p', {}, 'Kho hiện tại chưa đọc được an toàn. Có thể xuất bản phục hồi từ danh sách lưu giữ bên dưới.'),
        form('shared-import-form', [onReadBackup ? h('p', {}, 'Chọn tệp JSON sổ chung cục bộ. Bước này chỉ xem trước, chưa thay sổ đang dùng.') : control('Tệp JSON sổ chung', 'shared-backup-file', 'file', '', { required: true, accept: '.json,application/json' })], async values => {
          stage = null; stageExpectation = null; drafts.delete('shared-activate-form');
          const selected = onReadBackup ? await onReadBackup() : values['shared-backup-file'];
          if (!selected) { message = 'Đã hủy chọn bản sao. Sổ hiện tại không đổi.'; return; }
          if ((selected.size ?? 0) > 5 * 1024 * 1024) throw new Error('SHARED_BACKUP_TOO_LARGE');
          const raw = typeof selected.text === 'string' ? selected.text : await selected.text();
          let candidate;
          try { candidate = await stageSharedRestore(raw, { namespace: state?.namespace || namespace }); }
          catch (error) { throw new SharedBackupInputError(error); }
          const recovery = !state && !!activeRow && !activeRow.valid;
          if (!state && !recovery) throw new Error('SHARED_RECOVERY_EXPECTATION_UNAVAILABLE');
          await repository.stageRestore(candidate, recovery ? { recovery: true } : {});
          stage = candidate; stageExpectation = { datasetId: state?.datasetId ?? activeRow.datasetId, revision: state?.revision ?? activeRow.revision, recovery };
          message = 'Đã kiểm tra và lưu bản xem trước. Sổ hiện tại chưa đổi.';
        }, 'Chọn và xem trước bản sao', { writable: false, disabled: !repository })),
      stage ? card(h('h3', {}, 'Bản xem trước khôi phục'), h('p', {}, `${stage.report.name || 'Sổ chung trống'} · ${stage.report.entries} khoản · ${stage.report.bills} hóa đơn · ${stage.report.plans} thỏa thuận.`),
        stageExpectation ? form('shared-activate-form', [checkbox('shared-restore-backup-ack', 'Tôi đã xuất và giữ bản sao hoặc toàn bộ tệp phục hồi của kho sổ chung hiện tại.'), checkbox('shared-restore-replace-ack', 'Tôi muốn kích hoạt đúng bản xem trước này. Sổ cũ được lưu giữ để phục hồi, không trộn hai sổ.'), stageExpectation.recovery ? checkbox('shared-restore-recovery-ack', 'Tôi hiểu kho đang dùng không đọc được an toàn. Tôi muốn phục hồi từ tệp hợp lệ đã xem trước và giữ nguyên kho lỗi để kiểm tra sau.') : null], async values => {
          if (!acknowledgement(values['shared-restore-backup-ack']) || !acknowledgement(values['shared-restore-replace-ack'])) throw new Error('Cần giữ bản sao và xác nhận thay sổ trước khi kích hoạt.');
          if (stageExpectation.recovery && !acknowledgement(values['shared-restore-recovery-ack'])) throw new Error('Cần xác nhận rõ việc phục hồi từ tệp khi kho hiện tại không đọc được.');
          try { state = await repository.activateStage(stage.id, { expectedDatasetId: stageExpectation.datasetId, expectedRevision: stageExpectation.revision, confirm: true, backupAcknowledged: true, ...(stageExpectation.recovery ? { recoveryConfirmation: true } : {}) }); }
          catch (error) { readOnly = true; throw error; }
          drafts.clear(); selectedEntryId = null; readOnly = repository.writable === false; stage = null; stageExpectation = null; message = 'Đã kích hoạt bản sao sổ chung được xác nhận. Sổ trước vẫn được lưu giữ.'; await readRows();
        }, 'Kích hoạt bản xem trước', { writable: !stageExpectation.recovery, disabled: repository?.writable === false }) : note('Chưa xác nhận được định danh kho hiện tại để kích hoạt. Hãy giữ bản phục hồi và tải lại trước khi tiếp tục.', true),
        action('Bỏ bản xem trước', () => { stage = null; stageExpectation = null; render(); })) : null,
      card(h('h3', {}, 'Các bản lưu được giữ lại'), recoveryRows.length ? recoveryRows.slice(-recoveryLimit).reverse().map(row => h('article', {}, h('h4', {}, `${row.name || 'Sổ trống'}${row.active ? ' · đang dùng' : ''}`), h('p', {}, `${row.entries ?? '?'} khoản · bản ${row.revision ?? '?'} · ${row.valid ? 'đọc được' : 'chỉ xuất phục hồi'}`), actions(
        action('Xuất bản phục hồi', () => run('file', async () => downloadRecovery(row.datasetId))),
        !row.active && row.valid && expected ? action('Chọn phục hồi bản này', () => { rollbackTarget = { datasetId: row.datasetId, expectedDatasetId: expected.datasetId, expectedRevision: expected.revision }; render(); }, false, { disabled: !!pending || repository?.writable === false }) : null
      ))) : h('p', {}, 'Chưa có bản lưu giữ khác.'), recoveryRows.length > recoveryLimit ? action('Xem thêm bản lưu giữ', () => { recoveryLimit += 50; render(); }) : null),
      rollbackTarget ? card(h('h3', {}, 'Xác nhận phục hồi bản lưu giữ'), form('shared-rollback-form', [checkbox('shared-rollback-backup-ack', 'Tôi đã giữ bản sao hoặc bản phục hồi của kho hiện tại.'), checkbox('shared-rollback-ack', 'Tôi muốn dùng bản lưu đã chọn, giữ nguyên kho trước để có thể kiểm tra lại.')], async values => {
        if (!acknowledgement(values['shared-rollback-backup-ack']) || !acknowledgement(values['shared-rollback-ack'])) throw new Error('Cần giữ bản sao và xác nhận phục hồi.');
        state = await repository.rollback(rollbackTarget.datasetId, { expectedDatasetId: rollbackTarget.expectedDatasetId, expectedRevision: rollbackTarget.expectedRevision, confirm: true });
        drafts.clear(); selectedEntryId = null; rollbackTarget = null; stage = null; readOnly = repository.writable === false; message = 'Đã phục hồi bản lưu được chọn. Kho trước vẫn được giữ.'; await readRows();
      }, 'Phục hồi bản lưu', { writable: false, disabled: repository?.writable === false }), action('Hủy phục hồi', () => { rollbackTarget = null; render(); })) : null
    ];
  }

  function help() {
    return card(h('h3', {}, 'Dùng chung một thiết bị'), h('p', {}, 'Tên A/B chỉ ghi nhận ai được gắn với một khoản hoặc một xác nhận. Ai mở được ứng dụng đều có thể chọn một trong hai nhãn; ứng dụng không xác minh người thật, không có PIN và không đồng bộ máy khác.'), h('p', {}, 'Góp quỹ tăng tiền quỹ. Chi từ quỹ giảm tiền quỹ và tính chi chung. Ứng tiền riêng tính chi chung, tạo nghĩa vụ cần hoàn. Hoàn ứng giảm tiền quỹ và nghĩa vụ; không tính chi lần hai.'), h('p', {}, 'Thỏa thuận và chốt kỳ cần ghi nhận đủ hai nhãn. Đây là cách đối chiếu trên thiết bị, không phải chữ ký hoặc xác thực của hai người.'), h('p', {}, 'Sổ chung không tự đọc hay chuyển giao dịch, tài khoản hoặc tài sản cá nhân. Hãy xuất riêng cả hai sổ trước khi chuyển thiết bị.'));
  }

  function render() {
    if (closed) return;
    handlers.clear();
    const header = h('div', { class: 'page-head' }, h('h2', {}, state?.space?.name || 'Sổ chung offline'), h('p', {}, 'Một thiết bị · VND · dữ liệu lưu riêng với sổ cá nhân'));
    const feedback = h('div', { id: 'shared-feedback', role: isError ? 'alert' : 'status', 'aria-live': isError ? 'assertive' : 'polite', class: message ? 'notice' + (isError ? ' error' : '') : '' }, message);
    if (pending === 'opening') { element.replaceChildren(header, feedback, h('p', { role: 'status' }, 'Đang mở kho sổ chung…')); return; }
    const nav = h('nav', { class: 'actions', 'aria-label': 'Chức năng sổ chung' }, [['overview', 'Tổng quan'], ['ledger', 'Giao dịch chung'], ['bills', 'Hóa đơn và mục tiêu'], ['agreement', 'Thỏa thuận'], ['close', 'Chốt kỳ'], ['data', 'Dữ liệu sổ chung'], ['help', 'Cách dùng và giới hạn']].map(([key, label]) => action(label, () => go(key), false, { disabled: !!pending || !hasBook() && !['overview', 'data', 'help'].includes(key), 'aria-current': key === route ? 'page' : null })));
    const selectors = hasBook() ? h('div', { class: 'grid' }, field('Nhãn ghi nhận · không xác thực', 'shared-actor', select('shared-actor', [['A', name('A')], ['B', name('B')]], actor, { disabled: !!pending, onChange: event => { actor = event.target.value; render(); } })), control('Tháng xem số liệu', 'shared-month', 'month', month, { disabled: !!pending, onChange: event => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) month = event.target.value; render(); } })) : null;
    let body;
    try {
      if (route === 'data') body = dataView();
      else if (route === 'help') body = help();
      else if (!hasBook()) body = readOnly || !state ? note('Chưa mở được kho ghi an toàn. Hãy giữ dữ liệu, tải lại hoặc vào Dữ liệu sổ chung để xuất phục hồi.', true) : blankBook();
      else body = route === 'entry' ? entryDetail() : route === 'ledger' ? ledger() : route === 'bills' ? billsAndGoal() : route === 'agreement' ? agreements() : route === 'close' ? closing() : overview();
    } catch { readOnly = true; body = note('Chưa hiển thị được số liệu an toàn. Hãy giữ dữ liệu và dùng Dữ liệu sổ chung để xuất phục hồi hoặc tải lại.', true); }
    const finishViewport = viewTransition([namespace, route, hasBook() ? 'book' : 'blank'].join('|'));
    element.replaceChildren(...[header, feedback, readOnly ? note('Chế độ chỉ đọc: chưa xác nhận được khả năng ghi an toàn. Không ghi đè hoặc tạo lại kho.', true) : null, actions(action('Tải lại sổ chung', refresh)), selectors, nav, h('div', { id: 'shared-workspace', 'aria-busy': String(!!pending) }, body)].filter(Boolean));
    finishViewport(header.querySelector('h2'));
  }

  const readyPromise = (async () => {
    try {
      if (typeof repositoryFactory !== 'function') throw new Error('Chưa có kho sổ chung trên nền tảng này.');
      repository = await repositoryFactory();
      if (closed) return;
      try { state = await repository.readSnapshot(); readOnly = repository.writable === false; }
      catch (error) { readOnly = true; route = 'data'; message = readableError(error); isError = true; }
      await readRows();
      if (closed) return;
      watchRepository();
    } catch (error) { readOnly = true; message = readableError(error); isError = true; }
    finally { pending = null; if (closed) { unsubscribe?.(); repository?.close?.(); } else render(); }
  })();
  render();
  return { element, readyPromise, submit, go, refresh, snapshot: () => state ? structuredClone(state) : null, isBusy: () => !!pending,
    setActor(value) { if (!closed && !pending && ['A', 'B'].includes(value)) { actor = value; render(); return true; } return false; },
    back() { if (pending) return true; if (stage) { stage = null; stageExpectation = null; render(); return true; } if (rollbackTarget) { rollbackTarget = null; render(); return true; } if (route === 'entry') { route = 'ledger'; render(); return true; } if (route !== 'overview') { route = 'overview'; render(); return true; } return false; },
    close() { if (closed) return; closed = true; drafts.clear(); handlers.clear(); unsubscribe?.(); if (!pending) repository?.close?.(); }
  };
}
