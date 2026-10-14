import { sharedDocument } from './shared-embed.js';
import { calculateBalances, calculateDashboard, validateTransaction, createTransaction, updateAssetValue, importTransactionsCsv, localDate, isValidDate } from './ledger.js';
import { loadState, saveState, resetState, commitChange, undoChange, exportBackup, parseBackup, backupSummary, exportTransactionsCsv } from './storage.js';
import { getTemplates, previewAllocation, saveBudgetTemplate, getBudgetSummary, applyIncomeAllocation, createIncomeWithAllocation, linkBudgetExpense } from './budgeting.js';
import { createDemoState } from './sample.js';

const today = () => localDate();
const money = value => `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Number(value) || 0)} ₫`;
const shortMoney = value => {
  const n = Number(value) || 0;
  if (Math.abs(n) >= 1e9) return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(n / 1e9)} tỷ`;
  if (Math.abs(n) >= 1e6) return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(n / 1e6)} tr`;
  if (Math.abs(n) >= 1e3) return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(n / 1e3)}k`;
  return `${Math.round(n)}`;
};
const dateText = value => {
  if (!value) return 'Chưa có ngày';
  const [y, m, d] = String(value).slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : String(value);
};
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safe = value => escapeHtml(value);
const amountClass = value => Number(value) < 0 ? 'negative' : '';
const iconPaths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  receipt: '<path d="M5 3h14v18l-3-2-4 2-4-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4M12 17h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  arrowUp: '<path d="m6 15 6-6 6 6M12 9v11"/>',
  arrowDown: '<path d="m6 9 6 6 6-6M12 4v11"/>',
  wallet: '<rect x="3" y="6" width="18" height="15" rx="3"/><path d="M3 10h18M6 6V4h12"/><circle cx="17" cy="15" r="1"/>',
  card: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19M6 15h4"/>',
  chart: '<path d="M4 20V4M4 20h16M8 16l4-5 3 2 5-7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 17v3h16v-3"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  alert: '<path d="M12 3 2 21h20L12 3z"/><path d="M12 9v5M12 18h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 10v6M12 7h.01"/>',
  close: '<path d="M5 5 19 19M19 5 5 19"/>',
  edit: '<path d="M4 20h4l11-11a2 2 0 0 0-4-4L4 16v4z"/><path d="m13 7 4 4"/>',
  refresh: '<path d="M20 7V3l-3 3a8 8 0 1 0 3 6"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M15 9.5c-1.4-1.5-5.5-1.1-5.5 1.1 0 2.5 5.8.8 5.8 3.5 0 2.3-4.1 3-6.3 1"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${iconPaths[name] || iconPaths.info}</svg>`;
const accountName = id => state.accounts.find(a => a.id === id)?.name || id || '—';
const assetName = id => state.assets.find(a => a.id === id)?.name || id || '—';
const cardName = id => state.cards.find(c => c.id === id)?.name || id || '—';
const planRemaining = p => Math.max(0, Number(p.amount || 0) - Number(p.settledAmount || 0));

const storageKey = 'financial-assistant-prototype-v1';
let state;
let storageError = null;
try { state = loadState() || createDemoState(); }
catch (error) { console.error(error); storageError = error.message || 'Không đọc được dữ liệu cục bộ.'; state = createDemoState(); }
let view = 'dashboard';
let txFilter = 'all';
let txSearch = '';
let pendingImportCsv = null;
let toastTimer;
let writeBusy = false;
let modalRevision = 0;
let pendingReadRevision = 0;

function toast(message, type = 'success') {
  const host = document.getElementById('toast-root');
  host.innerHTML = `<div class="toast ${type === 'error' ? 'error' : ''}">${safe(message)}</div>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { host.innerHTML = ''; }, 4200);
}
async function persistAndRender(next, label = 'Cập nhật sổ') {
  if (storageError) throw new Error('Dữ liệu cũ đang cần khôi phục. Hãy sao lưu và đặt lại trước khi ghi mới.');
  if (writeBusy) throw new Error('Đang lưu thao tác trước, hãy đợi.');
  const candidate = commitChange(state, next, label);
  writeBusy = true;
  try { await saveState(candidate); state = candidate; render(); } finally { writeBusy = false; }
}
function setView(next) { view = next; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
function mountIcons(scope = document) { scope.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); }); }
function render() {
  const shared = view === 'shared';
  const fileNotice = document.getElementById('file-origin-notice');
  if (fileNotice) fileNotice.hidden = globalThis.location?.protocol !== 'file:';
  document.getElementById('view').hidden = shared;
  document.getElementById('shared-view').hidden = !shared;
  document.querySelector('.top-add').hidden = shared;
  document.getElementById('today-label').hidden = shared;
  document.querySelector('.scope-note').hidden = shared;
  document.querySelectorAll('[data-view]').forEach(button => {
    button.classList.toggle('active', button.dataset.view === view);
    if (button.dataset.view === view) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  if (shared) {
    document.title = 'Không gian chung tùy chọn · Mạch tiền';
    document.getElementById('page-title').textContent = 'Không gian chung';
    const frame = document.getElementById('shared-frame');
    if (!frame.hasAttribute('srcdoc')) frame.srcdoc = sharedDocument;
    mountIcons();
    return;
  }
  if (storageError) {
    document.title = 'Cần khôi phục dữ liệu · Mạch tiền';
    document.getElementById('page-title').textContent = 'Cần khôi phục dữ liệu';
    let canDownload = false;
    try { canDownload = Boolean(globalThis.localStorage?.getItem(storageKey)); } catch { /* Storage unavailable. */ }
    document.getElementById('view').innerHTML = `${intro('Dữ liệu cục bộ cần được kiểm tra.', 'Ứng dụng đã dừng ghi để giữ nguyên dữ liệu đang có trong trình duyệt.')}
      <section class="card recovery-card"><div class="notice warn">${icon('alert')} ${safe(storageError)}</div><p>Hãy tải một bản sao dữ liệu cũ trước khi đặt lại. Việc đặt lại sẽ xóa dữ liệu đã lưu trên trình duyệt này và nạp dữ liệu mẫu.</p><div class="toolbar-actions">${canDownload ? `<button type="button" class="button" data-action="download-backup">${icon('upload')} Tải bản sao dữ liệu cũ</button>` : ''}<button type="button" class="button button-danger" data-action="reset-demo">${icon('refresh')} Đặt lại dữ liệu mẫu</button></div></section>`;
    mountIcons();
    return;
  }
  let dash;
  try { dash = calculateDashboard(state); }
  catch (error) { console.error(error); document.getElementById('view').innerHTML = `<div class="notice warn">Không thể tính dữ liệu: ${safe(error.message)}</div>`; return; }
  document.title = `${{ dashboard: 'Tổng quan', transactions: 'Sổ giao dịch', assets: 'Tài sản', calendar: 'Lịch tiền', guide: 'Hướng dẫn', allocations: 'Phân bổ & mẫu', data: 'Dữ liệu & lịch sử' }[view]} · Mạch tiền`;
  document.getElementById('page-title').textContent = { dashboard: 'Tổng quan', transactions: 'Sổ giao dịch', assets: 'Tài sản', calendar: 'Lịch tiền', guide: 'Hướng dẫn', allocations: 'Phân bổ & mẫu', data: 'Dữ liệu & lịch sử' }[view];
  document.getElementById('today-label').textContent = new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  const html = { dashboard: renderDashboard, transactions: renderTransactions, assets: renderAssets, calendar: renderCalendar, guide: renderGuide, allocations: renderAllocations, data: renderData }[view](dash);
  document.getElementById('view').innerHTML = `${!globalThis.navigator?.locks?.request ? '<div class="notice warn">Chế độ chỉ đọc: trình duyệt này chưa có Web Locks để ghi an toàn. Vẫn có thể xem và xuất JSON/CSV; mở bằng trình duyệt hỗ trợ trên localhost để ghi.</div>' : ''}${html}`;
  mountIcons();
}

function intro(title, subtitle, buttons = '') {
  return `<div class="intro-row"><div><h2>${title}</h2><p>${subtitle}</p></div>${buttons ? `<div class="intro-actions">${buttons}</div>` : ''}</div>`;
}
function heading(title, subtitle = '', action = '') {
  return `<div class="section-heading"><div><h3>${title}</h3>${subtitle ? `<p>${subtitle}</p>` : ''}</div>${action}</div>`;
}
function metric(label, value, iconName, color = '') {
  return `<div class="metric"><div class="metric-top"><span>${label}</span>${icon(iconName)}</div><strong class="${color}">${money(value)}</strong></div>`;
}
function accountRows(dash) {
  return state.accounts.map(a => {
    const balance = Number(dash.balances.accounts[a.id] || 0);
    return `<div class="list-row"><span class="list-icon ${a.type === 'credit' ? 'credit' : ''}">${icon(a.type === 'credit' ? 'card' : 'wallet')}</span><span class="list-body"><strong>${safe(a.name)}</strong><small>${a.type === 'credit' ? 'Thẻ tín dụng · số dư có dấu' : 'Tài khoản tiền'}</small></span><span class="list-value ${balance < 0 ? 'negative' : ''}">${money(balance)}</span></div>`;
  }).join('') || `<div class="empty-state">Chưa có tài khoản.</div>`;
}
function upcomingRows(dash, limit = 4) {
  const rows = (dash.upcoming || []).filter(p => Number(p.amount) > 0).slice(0, limit);
  return rows.map(p => `<div class="list-row"><span class="list-icon ${p.kind === 'expense' ? 'credit' : ''}">${icon(p.kind === 'income' ? 'arrowDown' : 'clock')}</span><span class="list-body"><strong>${safe(p.label)}</strong><small>${dateText(p.date)}${p.cardId ? ` · ${safe(cardName(p.cardId))}` : ''}</small></span><span class="list-value ${p.kind === 'income' ? 'positive' : 'negative'}">${p.kind === 'income' ? '+' : '−'}${money(p.amount)}</span></div>`).join('') || `<div class="empty-state">Chưa có khoản dự kiến trong 30 ngày tới.</div>`;
}
function issuesCard(dash) {
  const issues = Array.isArray(dash.issues) ? dash.issues : [];
  return `<section class="card"><div class="card-heading"><div><h3>Cần kiểm tra</h3><p>Những điểm làm số liệu chưa trọn vẹn</p></div></div>${issues.length ? `<div class="issue-list">${issues.slice(0, 4).map(issue => `<div class="list-row"><span class="list-icon warn">${icon('alert')}</span><span class="list-body"><strong class="issue-text">${safe(typeof issue === 'string' ? issue : issue.message || issue.label || 'Cần kiểm tra dữ liệu')}</strong></span></div>`).join('')}</div>` : `<div class="notice">${icon('check')} Chưa có cảnh báo từ các quy tắc hiện có. Số liệu chưa được đối soát với sao kê.</div>`}</section>`;
}
function cashChart() {
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(); date.setDate(1); date.setMonth(date.getMonth() - (5 - index));
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const rows = state.transactions.filter(t => String(t.date || '').startsWith(key));
    return { label: `T${date.getMonth() + 1}`, income: rows.filter(t => t.kind === 'income').reduce((s, t) => s + Number(t.amount || 0), 0), expense: rows.filter(t => t.kind === 'expense').reduce((s, t) => s + Number(t.amount || 0), 0) };
  });
  const max = Math.max(1, ...months.flatMap(m => [m.income, m.expense]));
  const grid = [0, 37.5, 75, 112.5, 150].map(y => `<line x1="0" y1="${y}" x2="600" y2="${y}" stroke="#edf1ed" stroke-width="1" />`).join('');
  const bars = months.map((m, i) => {
    const x = 29 + i * 100;
    const incomeHeight = Math.max(m.income ? 3 : 0, 140 * m.income / max);
    const expenseHeight = Math.max(m.expense ? 3 : 0, 140 * m.expense / max);
    return `<rect x="${x}" y="${150 - incomeHeight}" width="22" height="${incomeHeight}" rx="3" fill="#afd8ae"><title>Thu ${money(m.income)}</title></rect><rect x="${x + 25}" y="${150 - expenseHeight}" width="22" height="${expenseHeight}" rx="3" fill="#28594c"><title>Chi ${money(m.expense)}</title></rect><text x="${x + 24}" y="179" text-anchor="middle" fill="#8c9b91" font-size="11">${m.label}</text>`;
  }).join('');
  return `<div class="chart" role="img" aria-label="Biểu đồ thu và chi theo sáu tháng"><div class="chart-y"><span>${shortMoney(max)}</span><span>${shortMoney(max / 2)}</span><span>0</span></div><svg class="chart-svg" viewBox="0 0 600 185" preserveAspectRatio="none" aria-hidden="true">${grid}${bars}</svg></div><div class="chart-legend"><span class="legend-item">Thu nhập</span><span class="legend-item expense">Chi tiêu</span></div>`;
}
function renderDashboard(dash) {
  const balances = dash.balances;
  return `${intro('Tiền của bạn, trong một bức tranh.', 'Theo dõi chi tiêu, khoản sắp đến hạn và tài sản từ cùng một sổ dữ liệu.', `<button type="button" class="button" data-action="import-csv">${icon('upload')} Nhập CSV</button>`)}
  <div class="dashboard-grid"><section class="hero"><div class="hero-content"><div class="hero-label">${icon('wallet')} Còn lại theo lịch đã nhập</div><div class="hero-amount ${amountClass(dash.safeToSpend)}">${money(dash.safeToSpend)}</div><p class="hero-caption">Ước tính dựa trên tiền hiện có, các khoản đã lên lịch trong 30 ngày và mức đệm. Chưa gồm chi phí chưa lên lịch và chưa trừ quỹ mục đích. Đây là góc nhìn theo lịch, không phải số tiền chắc chắn có thể tiêu hoặc tiền cộng thêm vào các quỹ.</p><div class="hero-footer"><span>${icon('clock')}</span><span>Dòng tiền dự kiến sau 30 ngày</span><strong>${money(dash.forecastNext30)}</strong></div></div></section><section class="hero-mini"><div class="hero-mini-top"><span>Tài sản ròng hiện tại</span><span class="circle-icon">${icon('chart')}</span></div><div class="hero-mini-value">${money(balances.netWorth)}</div><p>Tài sản trừ dư nợ thẻ. Giá trị các khoản đầu tư theo lần cập nhật gần nhất.</p></section></div>
  <div class="metric-grid">${metric('Thu vào tháng này', dash.monthlyIncome, 'arrowDown', 'positive')}${metric('Chi ra tháng này', dash.monthlyExpense, 'arrowUp', 'expense')}${metric('Đầu tư tháng này', dash.monthlyInvested, 'layers')}${metric('Đến hạn 30 ngày', dash.dueNext30, 'calendar')}</div>
  <div class="content-grid"><div class="stack"><section class="card"><div class="card-heading"><div><h3>Thu và chi 6 tháng</h3><p>Không tính chuyển tiền nội bộ và trả thẻ là chi tiêu mới.</p></div></div>${cashChart()}</section><section class="card"><div class="card-heading"><div><h3>Tài khoản & thẻ</h3><p>Số dư tính từ số đầu kỳ và các giao dịch đã ghi.</p></div><div class="toolbar-actions"><button type="button" class="button button-small" data-action="add-account">${icon('plus')} Thêm tài khoản</button><button type="button" class="button button-text button-small" data-view="transactions">Xem sổ ${icon('chevron')}</button></div></div><div class="account-list">${accountRows(dash)}</div></section></div><div class="stack"><section class="card"><div class="card-heading"><div><h3>Sắp diễn ra</h3><p>Các khoản dự kiến trong 30 ngày</p></div><button type="button" class="button button-text button-small" data-view="calendar">Xem lịch ${icon('chevron')}</button></div><div class="upcoming-list">${upcomingRows(dash)}</div></section>${issuesCard(dash)}</div></div>`;
}

const kindLabels = { income: 'Thu nhập', expense: 'Chi tiêu', transfer: 'Chuyển tiền', investment: 'Đầu tư' };
function txTitle(t) { return t.note || t.category || (t.kind === 'transfer' ? `${accountName(t.fromAccountId)} → ${accountName(t.toAccountId)}` : t.kind === 'investment' ? `Mua ${assetName(t.assetId)}` : kindLabels[t.kind] || 'Giao dịch'); }
function txDestination(t) {
  if (t.kind === 'transfer') return `${accountName(t.fromAccountId)} → ${accountName(t.toAccountId)}`;
  if (t.kind === 'investment') return `${accountName(t.fromAccountId || t.accountId)} → ${assetName(t.assetId)}`;
  return accountName(t.accountId);
}
function filteredTransactions() {
  return [...state.transactions].filter(t => txFilter === 'all' || t.kind === txFilter).filter(t => {
    const search = txSearch.trim().toLocaleLowerCase('vi-VN');
    return !search || `${txTitle(t)} ${t.category || ''} ${txDestination(t)}`.toLocaleLowerCase('vi-VN').includes(search);
  }).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id)));
}
function transactionRows() {
  const rows = filteredTransactions();
  return rows.length ? rows.map(t => `<tr><td><strong>${dateText(t.date)}</strong></td><td><span class="pill ${safe(t.kind)}">${safe(kindLabels[t.kind] || t.kind)}</span></td><td><strong>${safe(txTitle(t))}</strong><small>${safe(t.category || '')}</small></td><td>${safe(txDestination(t))}</td><td class="${t.kind === 'income' ? 'money-income' : t.kind === 'expense' ? 'money-expense' : 'money-neutral'}">${t.kind === 'income' ? '+' : t.kind === 'expense' ? '−' : ''}${money(t.amount)}</td></tr>`).join('') : `<tr><td colspan="5"><div class="empty-state">${icon('search')}<strong>Không thấy giao dịch phù hợp</strong><p>Thử bộ lọc khác hoặc thêm một giao dịch.</p></div></td></tr>`;
}
function renderTransactions(dash) {
  return `${intro('Mọi chuyển động đều có dấu vết.', 'Thu chi, chuyển tiền và mua tài sản được ghi riêng để báo cáo không đếm hai lần.', `<button type="button" class="button" data-action="import-csv">${icon('upload')} Nhập CSV</button><button type="button" class="button button-primary" data-action="add-transaction">${icon('plus')} Thêm giao dịch</button>`)}
  <div class="summary-strip"><div class="summary-item"><span>Thu trong tháng</span><strong class="delta-up">${money(dash.monthlyIncome)}</strong></div><div class="summary-item"><span>Chi trong tháng</span><strong class="delta-down">${money(dash.monthlyExpense)}</strong></div><div class="summary-item"><span>Số giao dịch đã ghi</span><strong>${state.transactions.length}</strong></div></div>
  <div class="table-toolbar"><div class="filter-tabs" role="group" aria-label="Lọc giao dịch">${[['all','Tất cả'], ...Object.entries(kindLabels)].map(([key, label]) => `<button type="button" data-filter="${key}" class="${txFilter === key ? 'active' : ''}">${label}</button>`).join('')}</div><label class="search-box">${icon('search')}<input id="tx-search" type="search" placeholder="Tìm giao dịch..." value="${safe(txSearch)}" aria-label="Tìm giao dịch" /></label></div>
  <section class="card table-card"><div class="table-wrap"><table class="data-table"><thead><tr><th>NGÀY</th><th>LOẠI</th><th>NỘI DUNG</th><th>TÀI KHOẢN / TÀI SẢN</th><th>SỐ TIỀN</th></tr></thead><tbody id="transactions-body">${transactionRows()}</tbody></table></div><div class="table-footer" id="transactions-count">Hiển thị ${filteredTransactions().length} giao dịch</div></section>
  <div class="notice info notice-below">${icon('info')} Trả thẻ là chuyển từ tài khoản tiền sang thẻ, nên khoản chi mua hàng không bị ghi thêm lần nữa.</div>`;
}

function assetType(type) { return ({ gold: 'Vàng', property: 'Bất động sản', fund: 'Chứng chỉ quỹ', stock: 'Cổ phiếu', savings: 'Tiết kiệm', other: 'Tài sản khác' })[type] || type || 'Tài sản'; }
function renderAssets(dash) {
  const b = dash.balances;
  const values = state.assets.map(a => ({ asset: a, value: Number(b.assets[a.id]?.currentValue ?? a.currentValue ?? 0), cost: Number(b.assets[a.id]?.costBasis ?? a.costBasis ?? 0) }));
  const colors = ['#386b56','#a9cb9b','#aec3da','#d3b78b','#b9a9ce','#8ab0ab','#e5c88d'];
  const alloc = [{ label: 'Tiền trong tài khoản', value: Math.max(0, Number(b.liquidCash || 0)) }, ...values.map(v => ({ label: v.asset.name, value: Math.max(0,v.value) }))];
  const allocTotal = alloc.reduce((s, a) => s + a.value, 0);
  const activeAlloc = alloc.filter(a => a.value > 0);
  let allocCursor = 0;
  const allocationRects = activeAlloc.map((a, i) => {
    const width = allocTotal ? 100 * a.value / allocTotal : 0;
    const rect = `<rect x="${allocCursor}" y="0" width="${width}" height="9" fill="${colors[i % colors.length]}"></rect>`;
    allocCursor += width;
    return rect;
  }).join('');
  return `${intro('Tài sản của bạn, nhìn rõ hơn.', 'Giá trị cập nhật thủ công. Mỗi khoản có ngày định giá để bạn biết số nào cần kiểm tra lại.')}
  <div class="summary-strip"><div class="summary-item"><span>Tổng tài sản</span><strong>${money(b.totalAssets)}</strong></div><div class="summary-item"><span>Dư nợ thẻ</span><strong class="delta-down">${money(b.creditDebt)}</strong></div><div class="summary-item"><span>Tài sản ròng</span><strong class="delta-up">${money(b.netWorth)}</strong></div></div>
  <div class="asset-layout"><div><div class="section-heading"><div><h3>Danh mục đang theo dõi</h3><p>${state.assets.length} tài sản · giá trị do bạn nhập</p></div></div><div class="asset-cards">${values.map(({ asset:a, value, cost }) => { const delta = value - cost; return `<article class="asset-card"><div class="asset-card-main"><span class="asset-card-icon">${icon('layers')}</span><div class="asset-card-name"><strong>${safe(a.name)}</strong><span>${safe(assetType(a.type))} · cập nhật ${dateText(a.asOf)}</span></div><div class="asset-card-price">${money(value)}</div></div><div class="asset-card-bottom"><div class="metadata">Vốn ghi nhận: ${money(cost)}<br/>Chênh lệch: <strong class="${delta >= 0 ? 'delta-up' : 'delta-down'}">${delta >= 0 ? '+' : ''}${money(delta)}</strong></div><button type="button" class="button button-small" data-action="update-asset" data-id="${safe(a.id)}">${icon('edit')} Cập nhật giá</button></div></article>`; }).join('') || `<div class="card empty-state">Chưa có tài sản được theo dõi.</div>`}</div></div>
  <div class="stack"><section class="card"><div class="card-heading"><div><h3>Phân bổ tài sản</h3><p>Tính trên tiền hiện có và giá trị tài sản.</p></div></div><div class="allocation-total"><strong>${money(allocTotal)}</strong><small>Giá trị dùng để phân bổ</small></div><svg class="allocation-track" viewBox="0 0 100 9" preserveAspectRatio="none" role="img" aria-label="Phân bổ tài sản">${allocationRects}</svg><div class="allocation-legend">${activeAlloc.map((a, i) => `<div class="allocation-line"><span class="allocation-swatch swatch-${i % colors.length}"></span><span>${safe(a.label)}</span><strong>${allocTotal ? Math.round(100*a.value/allocTotal) : 0}%</strong></div>`).join('') || `<div class="empty-state">Chưa có giá trị để phân bổ.</div>`}</div></section><div class="notice info">${icon('info')} Chênh lệch so với vốn ghi nhận chưa phải lợi nhuận thực nhận. Giá trị bất động sản, vàng và quỹ cần bạn cập nhật định kỳ.</div></div></div>`;
}

function renderCalendar(dash) {
  const plans = [...state.plans].filter(p => String(p.date) >= today() && planRemaining(p) > 0).sort((a,b) => String(a.date).localeCompare(String(b.date)));
  return `${intro('Biết trước tiền đi đâu.', 'Các khoản dự kiến giúp bạn kiểm tra khả năng thanh toán trong 30 ngày tới.', `<button type="button" class="button button-primary" data-action="add-plan">${icon('plus')} Thêm khoản dự kiến</button>`)}
  <div class="summary-strip"><div class="summary-item"><span>Đến hạn 30 ngày</span><strong class="delta-down">${money(dash.dueNext30)}</strong></div><div class="summary-item"><span>Số dư dự kiến sau 30 ngày</span><strong>${money(dash.forecastNext30)}</strong></div><div class="summary-item"><span>Mức đệm đã đặt</span><strong>${money(state.settings?.buffer || 0)}</strong></div></div>
  <div class="calendar-grid"><section class="card"><div class="card-heading"><div><h3>Dòng tiền sắp tới</h3><p>Chỉ gồm các khoản bạn đã nhập vào lịch.</p></div></div>${plans.length ? `<div class="timeline">${plans.map(p => `<div class="timeline-row"><span class="timeline-dot ${p.kind}"></span><div class="timeline-card"><div><strong>${safe(p.label)}</strong><small>${dateText(p.date)} · ${safe(accountName(p.accountId))}${p.cardId ? ` · ${safe(cardName(p.cardId))}` : ''}${p.settledAmount ? ` · đã ghi ${money(p.settledAmount)}` : ''}</small></div><b class="${p.kind}">${p.kind === 'income' ? '+' : '−'}${money(planRemaining(p))}</b></div></div>`).join('')}</div>` : `<div class="empty-state">${icon('calendar')}<strong>Chưa có khoản sắp tới</strong><p>Thêm khoản dự kiến để nhìn trước dòng tiền.</p></div>`}</section>
  <div class="stack"><section class="card"><div class="card-heading"><div><h3>Kỳ thẻ tín dụng</h3><p>Ngày sao kê và ngày thanh toán bạn đã khai báo.</p></div></div><div class="card-due-grid">${state.cards.map(c => `<div class="due-card"><strong>${safe(c.name)}</strong><p>Hạn mức: ${money(c.limit || 0)}</p><div class="due-days"><span>Chốt sao kê<b>Ngày ${Number(c.statementDay) || '—'}</b></span><span>Đến hạn<b>Ngày ${Number(c.dueDay) || '—'}</b></span></div></div>`).join('') || `<div class="empty-state">Chưa có thẻ.</div>`}</div></section><div class="notice warn">${icon('alert')} Lịch này không tự tạo khoản trả thẻ từ giao dịch. Hãy thêm khoản dự kiến và gắn giao dịch trả thẻ với khoản đó khi đã thanh toán.</div></div></div>`;
}

function renderGuide() {
  return `${intro('Bắt đầu từ dữ liệu mẫu.', 'Thử quy trình ghi chép và kiểm tra mà không cần liên kết ngân hàng hay tải dữ liệu cá nhân lên máy chủ.')}
  <div class="guide-grid"><div class="guide-step"><span class="step-number">01</span><h3>Xem bức tranh hiện tại</h3><p>Tổng quan đặt tiền, khoản sắp đến hạn và giá trị tài sản vào cùng một nơi.</p></div><div class="guide-step"><span class="step-number">02</span><h3>Ghi một chuyển động</h3><p>Thêm thu, chi, chuyển khoản hoặc mua tài sản. Trả thẻ bằng loại “Chuyển tiền”.</p></div><div class="guide-step"><span class="step-number">03</span><h3>Kiểm tra tháng tới</h3><p>Thêm khoản dự kiến, cập nhật giá tài sản rồi xem số dư ước tính sau 30 ngày.</p></div></div>
  <div class="guide-lower"><section class="card"><div class="card-heading"><div><h3>Quy tắc tính quan trọng</h3><p>Giúp báo cáo thu chi sát thực tế hơn.</p></div></div><ul class="guide-list"><li>Mua hàng bằng thẻ là chi tiêu. Chuyển tiền trả thẻ chỉ thay đổi tài khoản và dư nợ, không phát sinh chi tiêu lần nữa.</li><li>Chuyển tiền giữa các tài khoản của bạn không phải thu nhập hay chi tiêu.</li><li>Mua tài sản làm giảm tiền sẵn có và tăng vốn đầu tư; giá trị tài sản được cập nhật riêng.</li><li>Khoản trả thẻ đã thanh toán cần gắn với khoản trong lịch để dự báo không trừ lần nữa.</li></ul><div class="guide-actions"><button type="button" class="button button-primary" data-action="add-transaction">${icon('plus')} Thử ghi giao dịch</button><button type="button" class="button" data-action="import-csv">${icon('upload')} Nhập CSV</button></div></section><section class="card"><div class="card-heading"><div><h3>Về bản thử nghiệm</h3><p>Giới hạn cần biết trước khi dùng.</p></div></div><ul class="guide-list"><li>Sổ thử nghiệm khởi tạo bằng <strong>dữ liệu mẫu</strong>; giao dịch bạn nhập sẽ trộn với dữ liệu mẫu. Không có bảng tính cá nhân nào được nạp sẵn.</li><li>Dữ liệu bạn thêm được lưu cục bộ trên trình duyệt này. Xóa dữ liệu trình duyệt có thể làm mất thông tin.</li><li>Có xuất CSV, sao lưu/khôi phục JSON và hoàn tác thao tác mới nhất ở mục Dữ liệu. Chưa sửa giao dịch cũ, xem trước CSV đầy đủ hoặc đối soát sao kê; hãy chỉ dùng dữ liệu thử nghiệm.</li><li>Chưa đồng bộ ngân hàng hoặc tự lấy giá thị trường. Giá tài sản cần bạn cập nhật.</li><li>“Còn lại theo lịch đã nhập” chưa gồm các khoản chưa lên lịch và không phải cam kết bạn có thể chi số đó.</li></ul><div class="guide-actions"><button type="button" class="button button-danger" data-action="reset-demo">${icon('refresh')} Đặt lại dữ liệu mẫu</button></div><div class="guide-disclaimer">Bản thử nghiệm dùng để khám phá quy trình sản phẩm, chưa phải công cụ tư vấn đầu tư hoặc số liệu kế toán đã đối soát.</div></section></div>`;
}

function closeModal() { modalRevision++; pendingReadRevision++; allocationDraft = null; reviewedAllocationKey = ''; restoreDraft = null; restoreExportedState = null; document.getElementById('modal-root').innerHTML = ''; document.body.style.overflow = ''; pendingImportCsv = null; }
function openModal(title, subtitle, body, footer) {
  modalRevision++; pendingReadRevision++;
  document.getElementById('modal-root').innerHTML = `<div class="modal-backdrop" data-action="close-modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-header"><div><h2 id="modal-title">${title}</h2><p>${subtitle}</p></div><button type="button" class="icon-button" data-action="close-modal" aria-label="Đóng">${icon('close')}</button></div><div class="modal-body">${body}</div><div class="modal-footer">${footer}</div></section></div>`;
  document.body.style.overflow = 'hidden';
  document.querySelector('#modal-root input, #modal-root select, #modal-root textarea')?.focus();
}
function field(label, name, content, full = false, note = '') { return `<div class="field ${full ? 'full' : ''}"><label for="${name}">${label}</label>${content}${note ? `<small>${note}</small>` : ''}</div>`; }
function input(name, type, value = '', attrs = '') { return `<input id="${name}" name="${name}" type="${type}" value="${safe(value)}" ${attrs} />`; }
function options(rows, selected = '', placeholder = '') { return `${placeholder ? `<option value="">${placeholder}</option>` : ''}${rows.map(r => `<option value="${safe(r.id)}" ${r.id === selected ? 'selected' : ''}>${safe(r.name)}</option>`).join('')}`; }
function accountSelect(name, selected, type) { const rows = state.accounts.filter(a => !type || a.type === type); return `<select id="${name}" name="${name}" required>${options(rows, selected)}</select>`; }
function assetSelect(name) { return `<select id="${name}" name="${name}" required>${options(state.assets)}</select>`; }
function cardPlanOptions(toAccountId) {
  const eligibleCardIds = state.cards.filter(c => c.accountId === toAccountId).map(c => c.id);
  return state.plans.filter(p => p.kind === 'expense' && p.cardId && eligibleCardIds.includes(p.cardId) && planRemaining(p) > 0).map(p => ({ id: p.id, name: `${p.label} · ${dateText(p.date)} · còn ${money(planRemaining(p))}` }));
}
function accountCardFields() {
  return `${field('Tên thẻ', 'cardName', input('cardName','text','','required maxlength="80" placeholder="Ví dụ: HSBC Visa"'))}${field('Hạn mức (VND)', 'limit', input('limit','number','','required min="1" step="1"'))}${field('Ngày chốt sao kê', 'statementDay', input('statementDay','number','','required min="1" max="31" step="1"'))}${field('Ngày đến hạn', 'dueDay', input('dueDay','number','','required min="1" max="31" step="1"'))}`;
}
function openAccountModal() {
  const body = `<form id="account-form"><div id="form-error"></div><div class="form-grid">${field('Tên tài khoản', 'name', input('name','text','','required maxlength="80" placeholder="Ví dụ: Tài khoản lương"'),true)}${field('Loại tài khoản', 'type', `<select id="type" name="type"><option value="cash">Tiền / ngân hàng</option><option value="credit">Thẻ tín dụng</option></select>`)}${field('Số dư đầu kỳ (VND)', 'openingBalance', input('openingBalance','number','0','required min="0" step="1"'),false,'Nếu là thẻ tín dụng, nhập dư nợ ban đầu dưới dạng số dương.')}<div id="account-card-fields" class="form-grid"></div></div></form>`;
  openModal('Thêm tài khoản', 'Ghi số dư đầu kỳ để các giao dịch sau đó được tính chính xác.', body, `<button type="button" class="button" data-action="close-modal">Hủy</button><button type="submit" form="account-form" class="button button-primary">${icon('check')} Thêm tài khoản</button>`);
}
function transactionFields(kind, toAccountId) {
  if (kind === 'income' || kind === 'expense') return `${field('Tài khoản', 'accountId', accountSelect('accountId', '', ''), true)}${field('Nhóm / nguồn', 'category', input('category', 'text', '', 'placeholder="Ví dụ: Ăn uống, Lương" maxlength="80"'), true)}${kind === 'income' ? incomeAllocationFields() : expenseFundField()}`;
  if (kind === 'investment') return `${field('Lấy tiền từ', 'fromAccountId', accountSelect('fromAccountId', '', 'cash'))}${field('Tài sản mua', 'assetId', assetSelect('assetId'))}<div class="form-note form-note-span">Mua tài sản làm giảm tiền mặt. Giá trị hiện tại được cập nhật ở trang Tài sản.</div>`;
  const cash = state.accounts.find(a => a.type === 'cash')?.id;
  const credit = state.accounts.find(a => a.type === 'credit')?.id;
  const target = toAccountId || credit || state.accounts.find(a => a.id !== cash)?.id;
  const plans = cardPlanOptions(target);
  return `${field('Từ tài khoản', 'fromAccountId', accountSelect('fromAccountId', cash))}${field('Đến tài khoản / thẻ', 'toAccountId', accountSelect('toAccountId', target))}${field('Đánh dấu khoản đã lên lịch', 'planId', `<select id="planId" name="planId">${options(plans, '', 'Không gắn với lịch')}</select>`, true, 'Nếu đây là tiền trả thẻ đã lên lịch, hãy chọn khoản tương ứng để dự báo không trừ lần nữa. Nếu bỏ qua, bạn cần tự cập nhật lịch.')}<div class="form-note form-note-span">Chuyển tiền, kể cả trả thẻ, không cộng thêm vào chi tiêu.</div>`;
}
function openTransactionModal(templateId = '') {
  allocationDraft = null; reviewedAllocationKey = ''; restoreDraft = null;
  const body = `<form id="transaction-form"><div id="form-error"></div><div class="form-grid">${field('Loại giao dịch', 'kind', `<select id="kind" name="kind" required>${Object.entries(kindLabels).map(([value,label]) => `<option value="${value}">${label}</option>`).join('')}</select>`)}${field('Ngày', 'date', input('date','date',today(),`required max="${today()}"`))}${field('Số tiền (VND)', 'amount', input('amount','number','','required min="1" step="1" placeholder="0"'), true)}<div id="transaction-fields" class="form-grid">${transactionFields('income')}</div>${field('Ghi chú', 'note', input('note','text','','placeholder="Mô tả ngắn cho giao dịch" maxlength="160"'), true)}</div></form>`;
  openModal('Thêm giao dịch', 'Phân loại đúng để tiền, nợ và tài sản được tính nhất quán.', body, `<button type="button" class="button" data-action="close-modal">Hủy</button><button type="submit" form="transaction-form" class="button button-primary">${icon('check')} Lưu giao dịch</button>`);
  if (templateId) { document.getElementById('allocation-mode').value = 'template'; beginAllocationEditor(templateId); }
}
function openAssetModal(id) {
  const a = state.assets.find(x => x.id === id); if (!a) return;
  const displayedValue = calculateBalances(state).assets[id]?.currentValue ?? a.currentValue;
  const body = `<form id="asset-form" data-id="${safe(id)}"><div id="form-error"></div><div class="form-grid">${field('Tài sản', 'asset-name', `<input id="asset-name" value="${safe(a.name)}" disabled />`, true)}${field('Giá trị tại ngày định giá (VND)', 'currentValue', input('currentValue','number',displayedValue,'required min="0" step="1"'))}${field('Ngày định giá', 'asOf', input('asOf','date',today(),'required'))}</div><div class="form-note">Giá trị gợi ý là số đang hiển thị, đã gồm các khoản mua được ghi sau lần định giá trước. Hãy sửa theo giá trị thực tế tại ngày bạn chọn.</div></form>`;
  openModal('Cập nhật giá trị', 'Ghi giá trị và ngày định giá để số liệu có thời điểm rõ ràng.', body, `<button type="button" class="button" data-action="close-modal">Hủy</button><button type="submit" form="asset-form" class="button button-primary">Lưu giá trị</button>`);
}
function openPlanModal() {
  const cash = state.accounts.filter(a => a.type === 'cash');
  const body = `<form id="plan-form"><div id="form-error"></div><div class="form-grid">${field('Tên khoản dự kiến', 'label', input('label','text','','required maxlength="100" placeholder="Ví dụ: Trả thẻ tháng 10"'),true)}${field('Ngày dự kiến', 'date', input('date','date',today(),`required min="${today()}"`))}${field('Loại', 'kind', `<select id="kind" name="kind"><option value="expense">Tiền ra</option><option value="income">Tiền vào</option></select>`)}${field('Số tiền (VND)', 'amount', input('amount','number','','required min="1" step="1"'))}${field('Tài khoản thanh toán / nhận', 'accountId', `<select id="accountId" name="accountId" required>${options(cash)}</select>`)}${field('Gắn với thẻ (nếu trả thẻ)', 'cardId', `<select id="cardId" name="cardId">${options(state.cards,'','Không gắn với thẻ')}</select>`,true,'Chọn thẻ để có thể ghép giao dịch trả thẻ với khoản dự kiến này.')}</div></form>`;
  openModal('Thêm khoản dự kiến', 'Khoản này sẽ được tính vào lịch tiền cho đến khi đã ghi nhận.', body, `<button type="button" class="button" data-action="close-modal">Hủy</button><button type="submit" form="plan-form" class="button button-primary">Lưu vào lịch</button>`);
}
function openImportModal() {
  pendingImportCsv = null;
  const body = `<form id="import-form"><div id="form-error"></div><div class="form-grid">${field('Chọn tệp CSV', 'csv-file', `<input id="csv-file" name="csv-file" type="file" accept=".csv,text/csv" />`, true)}${field('Hoặc dán nội dung CSV', 'csv-text', `<textarea id="csv-text" name="csv-text" placeholder="date,kind,amount,accountId,..."></textarea>`, true)}</div><div class="form-note">Các cột có thể dùng: <span class="code-inline">date,kind,amount,accountId,fromAccountId,toAccountId,assetId,category,note,planId</span>. Có thể nhập ID hoặc tên tài khoản / tài sản như dữ liệu mẫu. Dòng nghi trùng sẽ được báo để bạn kiểm tra, không tự nhập.</div><div id="import-result"></div></form>`;
  openModal('Nhập giao dịch CSV', 'Tệp được đọc tại trình duyệt. Có thể xuất CSV và sao lưu JSON ở mục Dữ liệu. Chưa có đối soát sao kê; chỉ dùng dữ liệu thử nghiệm.', body, `<button type="button" class="button" data-action="close-modal">Đóng</button><button type="submit" form="import-form" class="button button-primary">${icon('upload')} Nhập giao dịch</button>`);
}
function showFormError(message) { const host = document.getElementById('form-error'); if (host) host.innerHTML = `<div class="form-error">${safe(message)}</div>`; }
function importFeedback(result) {
  const errors = (result.errors || []).map(e => `Dòng ${e.row ?? '?'}: ${e.message || e}`);
  const duplicates = result.duplicates || [];
  return `<div class="import-result">Đã nhập <strong>${Number(result.imported) || 0}</strong> dòng; bỏ qua <strong>${Number(result.skipped) || 0}</strong> dòng.
    ${errors.length ? `<div class="import-messages"><strong>Dòng lỗi</strong>${errors.map(e => `<p>${safe(e)}</p>`).join('')}</div>` : ''}
    ${duplicates.length ? `<div class="import-messages"><strong>Dòng nghi trùng · chưa nhập</strong><p>Chỉ chọn dòng bạn đã kiểm tra và muốn nhập thêm.</p>${duplicates.map(e => `<label class="duplicate-choice"><input type="checkbox" class="duplicate-row" value="${Number(e.row)}" /><span>Dòng ${Number(e.row)}: ${safe(e.message || 'Giao dịch giống dữ liệu đã có.')}</span></label>`).join('')}<button type="button" class="button button-small button-soft import-accept" data-action="import-selected-duplicates">Nhập các dòng đã chọn</button></div>` : ''}</div>`;
}
function readTransaction(form) {
  const data = new FormData(form); const kind = String(data.get('kind'));
  const result = { date: String(data.get('date')), kind, amount: Number(data.get('amount')), note: String(data.get('note') || '').trim() };
  if (kind === 'income' || kind === 'expense') { result.accountId = String(data.get('accountId')); result.category = String(data.get('category') || '').trim(); }
  if (kind === 'transfer') { result.fromAccountId = String(data.get('fromAccountId')); result.toAccountId = String(data.get('toAccountId')); if (data.get('planId')) result.planId = String(data.get('planId')); }
  if (kind === 'investment') { result.fromAccountId = String(data.get('fromAccountId')); result.assetId = String(data.get('assetId')); }
  return result;
}
function errorList(result) { return Array.isArray(result?.errors) ? result.errors.map(e => typeof e === 'string' ? e : e.message || JSON.stringify(e)).join(' · ') : String(result?.errors || 'Dữ liệu chưa hợp lệ.'); }
async function handleSubmit(event) {
  const form = event.target; if (!['transaction-form','asset-form','plan-form','import-form','account-form','allocation-form','template-form','restore-form'].includes(form.id)) return;
  event.preventDefault();
  if (writeBusy) { showFormError('Đang lưu thao tác trước, hãy đợi.'); return; }
  try {
    if (form.id === 'allocation-form') {
      const data = reviewedAllocation();
      await persistAndRender(applyIncomeAllocation(state, { incomeId: form.dataset.incomeId, ...data }), 'Phân bổ khoản thu'); closeModal(); toast('Đã lưu phân bổ, không ghi thêm thu nhập.');
    } else if (form.id === 'template-form') {
      const name = String(new FormData(form).get('templateName') || '').trim();
      await persistAndRender(saveBudgetTemplate(state, { name, rows: allocationDraft.rows }), 'Lưu mẫu riêng'); closeModal(); toast('Đã lưu mẫu trên trình duyệt này.');
    } else if (form.id === 'restore-form') {
      await previewRestore(form);
    } else if (form.id === 'account-form') {
      const fd = new FormData(form); const name = String(fd.get('name') || '').trim(); const type = String(fd.get('type')); const opening = Number(fd.get('openingBalance'));
      if (!name || !['cash','credit'].includes(type) || !Number.isSafeInteger(opening) || opening < 0) { showFormError('Hãy nhập tên và số dư đầu kỳ hợp lệ.'); return; }
      if (state.accounts.some(a => a.name.trim().toLocaleLowerCase('vi-VN') === name.toLocaleLowerCase('vi-VN'))) { showFormError('Đã có tài khoản cùng tên.'); return; }
      const id = globalThis.crypto?.randomUUID?.() || `account-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
      const account = { id, name, type, openingBalance: type === 'credit' ? -opening : opening };
      let cards = state.cards;
      if (type === 'credit') {
        const cardNameValue = String(fd.get('cardName') || '').trim(); const limit = Number(fd.get('limit')); const statementDay = Number(fd.get('statementDay')); const dueDay = Number(fd.get('dueDay'));
        if (!cardNameValue || !Number.isSafeInteger(limit) || limit <= 0 || !Number.isInteger(statementDay) || statementDay < 1 || statementDay > 31 || !Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) { showFormError('Hãy nhập tên thẻ, hạn mức và ngày sao kê / đến hạn hợp lệ.'); return; }
        const cardId = globalThis.crypto?.randomUUID?.() || `card-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
        cards = [...cards, { id: cardId, name: cardNameValue, accountId: id, statementDay, dueDay, limit }];
      }
      await persistAndRender({ ...state, accounts: [...state.accounts, account], cards }, 'Thêm tài khoản'); closeModal(); toast('Đã thêm tài khoản.');
    } else if (form.id === 'transaction-form') {
      const input = readTransaction(form); const validation = validateTransaction(state, input);
      if (!validation.ok) { showFormError(errorList(validation)); return; }
      await saveTransactionForm(form, input); closeModal(); toast('Đã lưu giao dịch.');
    } else if (form.id === 'asset-form') {
      const fd = new FormData(form); await persistAndRender(updateAssetValue(state, form.dataset.id, Number(fd.get('currentValue')), String(fd.get('asOf'))), 'Cập nhật giá trị tài sản'); closeModal(); toast('Đã cập nhật giá trị tài sản.');
    } else if (form.id === 'plan-form') {
      const fd = new FormData(form); const label = String(fd.get('label') || '').trim(); const amount = Number(fd.get('amount')); const date = String(fd.get('date')); const kind = String(fd.get('kind')); const accountId = String(fd.get('accountId')); const cardId = String(fd.get('cardId') || '');
      if (!label || !isValidDate(date) || date < today() || !Number.isSafeInteger(amount) || amount <= 0 || !['income','expense'].includes(kind) || !state.accounts.some(a => a.id === accountId && a.type === 'cash') || (cardId && (kind !== 'expense' || !state.cards.some(c => c.id === cardId)))) { showFormError('Ngày dự kiến phải từ hôm nay; số tiền là số nguyên VND dương và tài khoản / thẻ phải hợp lệ.'); return; }
      const id = globalThis.crypto?.randomUUID?.() || `plan-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
      await persistAndRender({ ...state, plans: [...state.plans, { id, label, date, kind, amount, accountId, ...(cardId ? { cardId } : {}) }] }, 'Thêm lịch tiền'); closeModal(); toast('Đã thêm khoản dự kiến.');
    } else if (form.id === 'import-form') {
      const requestToken = ++pendingReadRevision, modalToken = modalRevision;
      const file = form.querySelector('#csv-file').files?.[0];
      if (file?.size > 5 * 1024 * 1024) throw new Error('Tệp CSV không quá 5 MiB.');
      const text = file ? await file.text() : form.querySelector('#csv-text').value;
      if (modalToken !== modalRevision || requestToken !== pendingReadRevision) return;
      if (!text.trim()) { showFormError('Hãy chọn tệp hoặc dán nội dung CSV.'); return; }
      const result = importTransactionsCsv(state, text);
      if (Number(result.imported) > 0) await persistAndRender(result.state, 'Nhập giao dịch CSV');
      pendingImportCsv = (result.duplicates || []).length ? text : null;
      document.getElementById('import-result').innerHTML = importFeedback(result);
      if (Number(result.imported) > 0) toast(`Đã nhập ${result.imported} giao dịch.`);
    }
  } catch (error) { console.error(error); showFormError(error.message || 'Không thể lưu dữ liệu.'); }
}


let allocationDraft = null;
let reviewedAllocationKey = '';
let restoreDraft = null;
let restoreExportedState = null;
const blankBudgetRow = () => ({ name: '', kind: 'fixed', value: 0, accountId: '' });
const cloneRows = rows => rows.map(row => ({ ...row }));
function incomeAllocationFields() {
  return `${field('Sau khi ghi thu', 'allocation-mode', '<select id="allocation-mode" name="allocation-mode"><option value="none">Chỉ ghi thu, chưa chia</option><option value="template">Ghi thu và áp mẫu</option><option value="custom">Ghi thu và tự chia lần này</option></select>', true)}<div id="allocation-panel" class="full"></div>`;
}
function expenseFundField() {
  const funds = getBudgetSummary(state).funds.map(fund => ({ id: fund.id, name: `${fund.name} · còn ${money(fund.balance)}` }));
  return field('Quỹ mục đích (tùy chọn)', 'expense-fund', `<select id="expense-fund" name="expense-fund">${options(funds, '', 'Không gắn quỹ · ghi chi bình thường')}</select>`, true, 'Không cần tạo hoặc áp mẫu để ghi chi. Chi không gắn quỹ vẫn trừ tài khoản nhưng không giảm một quỹ cụ thể. Tài khoản ở trên là nơi thực trả.');
}
function renderAllocations() {
  const summary = getBudgetSummary(state);
  return `${intro('Tiền ở đâu, dành cho việc gì.', 'Phân bổ là kế hoạch của tiền đã nhận. Số dư quỹ không cộng thêm vào tài sản.', '<button class="button button-primary" data-action="add-transaction">Ghi thu / chi</button><button class="button" data-action="new-template">Tạo mẫu từ đầu</button>')}
    <div class="metric-grid">${metric('Tiền mặt / ngân hàng', summary.liquidCash, 'wallet')}${metric('Còn trong các quỹ', summary.totalRemaining, 'coin')}${metric('Nợ thẻ đã ghi', summary.creditDebt, 'card')}${metric('Khả năng phân bổ thêm', summary.cashAvailable, 'layers')}</div>
    <div class="notice info">Khả năng phân bổ thêm = tối đa 0 hoặc tiền mặt/ngân hàng − nợ thẻ − tiền còn trong quỹ. Chưa tính đủ nghĩa vụ chưa nhập; không phải mức an toàn để tiêu. Phần chưa phân của khoản thu có thể lớn hơn tiền còn hiện tại.</div>
    ${summary.warnings.map(w => `<div class="notice warn notice-below">${safe(w)}</div>`).join('')}
    <section class="card budget-section"><div class="card-heading"><div><h3>Các khoản thu đã ghi</h3><p>Có thể chia tiếp phần còn lại; không tạo khoản thu thứ hai.</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Khoản thu / thực nhận</th><th>Đã phân</th><th>Chưa phân</th><th></th></tr></thead><tbody>${summary.incomes.slice().reverse().map(tx => `<tr><td><strong>${safe(txTitle(tx))}</strong><small>${dateText(tx.date)} · ${safe(accountName(tx.accountId))} · ${money(tx.amount)}</small></td><td>${money(tx.allocated)}</td><td>${money(tx.remaining)}</td><td>${tx.remaining > 0 ? `<button class="button button-small" data-action="allocate-income" data-id="${safe(tx.id)}">${tx.allocated ? 'Phân bổ tiếp' : 'Phân bổ sau'}</button>` : 'Đã phân hết'}</td></tr>`).join('') || '<tr><td colspan="4">Chưa có khoản thu.</td></tr>'}</tbody></table></div></section>
    <section class="card budget-section"><div class="card-heading"><div><h3>Quỹ mục đích</h3><p>Liên kết tài khoản chỉ là kế hoạch, không chuyển tiền. Chi đã gắn quỹ mới giảm số dư quỹ.</p></div></div>${summary.funds.map(fund => `<div class="list-row"><span class="list-body"><strong>${safe(fund.name)}</strong><small>Kế hoạch: ${fund.accountId ? safe(accountName(fund.accountId)) : 'chưa liên kết'} · đã phân ${money(fund.allocated)} · đã chi ${money(fund.spent)}</small></span><span class="list-value">${money(fund.balance)}</span></div>`).join('') || '<div class="empty-state">Chưa có quỹ. Bạn vẫn có thể ghi thu và chi bình thường.</div>'}</section>
    ${heading('Kho mẫu', 'Các tỷ lệ và số tiền là ví dụ để tự chỉnh, không phải lời khuyên tài chính.')}
    <div class="template-grid">${getTemplates(state).map(template => `<section class="card template-card"><span class="pill">${template.id.startsWith('builtin-') ? 'Mẫu tham khảo' : 'Mẫu của tôi · lưu cục bộ'}</span><h3>${safe(template.name)}</h3><p>${safe(template.description || 'Mẫu cá nhân')}</p><ul>${template.rows.map(row => `<li>${safe(row.name)}: ${row.kind === 'percent' ? `${row.value}% trên phần còn sau cố định` : row.kind === 'fixed' ? `${money(row.value)} mỗi lần áp dụng` : 'nhận phần dư'}</li>`).join('')}</ul><div class="toolbar-actions"><button class="button button-primary button-small" data-action="use-template" data-id="${safe(template.id)}">Dùng cho khoản thu mới</button><button class="button button-small" data-action="copy-template" data-id="${safe(template.id)}">Tùy chỉnh bản sao</button></div></section>`).join('')}</div>
    ${renderBudgetLearning()}`;
}
function renderBudgetLearning() {
  const cards = [
    ['Thu nhập biến động', 'Cần theo dõi mục tiêu kỳ và số đã cấp. Mẫu fixed hiện chạy lại mỗi lần, không tự bù nền tháng.', 'https://www.moneyhelper.org.uk/en/everyday-money/budgeting/how-to-budget-for-an-irregular-income'],
    ['Góp dần cho chi định kỳ', 'Tự tính phần thiếu chia số kỳ còn lại. Chưa tự điều chỉnh theo ngày đích hoặc cap.', 'https://goodbudget.com/help/getting-started-guide/step-1-add-envelopes/'],
    ['Quỹ khẩn cấp đến mục tiêu', 'Tự chọn mục tiêu theo hoàn cảnh. Chưa có cap hay tự dừng khi quỹ đủ.', 'https://www.consumerfinance.gov/an-essential-guide-to-building-an-emergency-fund/'],
    ['Đệm tiền tháng sau', 'Đệm vận hành khác quỹ khẩn cấp. Chưa chuyển kỳ hoặc kiểm tra cấp trùng.', 'https://www.ynab.com/guide/stop-living-paycheck-to-paycheck'],
    ['Trả nợ theo thứ tự', 'Chưa có mô hình lãi, tối thiểu, xếp hạng hay thanh toán. Dành quỹ trả nợ không làm giảm nợ.', 'https://www.consumerfinance.gov/archive/blog/how-reduce-your-debt/'],
    ['Tiền chung và riêng', 'Mức góp cần được hai bên thống nhất. Không tự chia sẻ sổ hay tính đóng góp hộ gia đình.', 'https://www.moneyhelper.org.uk/en/everyday-money/budgeting/should-we-manage-money-jointly-or-separately'],
    ['Đủ tới lần thu kế tiếp', 'Chưa tự phân theo hóa đơn và ngày thu. Khoản thu dự kiến không tăng nguồn phân bổ.', 'https://www.consumerfinance.gov/documents/10038/cfpb_creating-cash-flow-budget_tool_2021-08.pdf']
  ];
  return `<section class="budget-section"><h3>Hiểu trước khi áp dụng</h3><p>50/30/20 là quy tắc tham khảo; 6 hũ là cách chia mục đích. Phong bì giúp theo dõi từng quỹ; zero-based giao việc cho tiền, không có nghĩa phải tiêu hết. Dành cho mình trước không bỏ qua nghĩa vụ đến hạn. “Thiết yếu trước” là ví dụ do app thiết kế.</p><p class="source-links">Nguồn: <a href="https://files.consumerfinance.gov/f/201603_cfpb_rules-to-live-by_my-spending-rule-to-live-by.pdf" target="_blank" rel="noopener noreferrer">CFPB · 50/30/20</a> · <a href="https://www.harveker.com/blog/6-step-money-managing-system/" target="_blank" rel="noopener noreferrer">T. Harv Eker · JARS</a> · <a href="https://www.ynab.com/blog/what-is-a-zero-based-budget" target="_blank" rel="noopener noreferrer">YNAB · zero-based</a> · <a href="https://goodbudget.com/how-it-works/" target="_blank" rel="noopener noreferrer">Goodbudget · phong bì</a> · <a href="https://www.fdic.gov/consumer-resource-center/2024-01/starting-small-can-lead-big-savings" target="_blank" rel="noopener noreferrer">FDIC · dành trước</a></p><h3>Các cách khác · chỉ tìm hiểu, chưa tự động áp dụng</h3><div class="template-grid learning-grid">${cards.map(([name, text, href]) => `<article class="card template-card"><span class="pill">Chỉ học · chưa triển khai</span><h4>${name}</h4><p>${text}</p><a href="${href}" target="_blank" rel="noopener noreferrer">Đọc nguồn ngoài ứng dụng ↗</a></article>`).join('')}</div></section>`;
}
function beginAllocationEditor(templateId = '') {
  const mode = document.getElementById('allocation-mode')?.value || 'template';
  reviewedAllocationKey = '';
  if (mode === 'none') { allocationDraft = null; document.getElementById('allocation-panel').innerHTML = ''; return; }
  const templates = getTemplates(state);
  const template = mode === 'custom' ? null : templates.find(t => t.id === templateId) || templates[0];
  allocationDraft = { rows: template ? cloneRows(template.rows) : [blankBudgetRow()], templateId: template?.id || '', label: template?.name || 'Tự chia lần này' };
  document.getElementById('allocation-panel').innerHTML = `${mode === 'template' ? field('Mẫu cho lần này', 'budget-template', `<select id="budget-template">${options(templates, template.id)}</select>`, true) : '<p>Tự chia riêng lần này, không bắt buộc lưu mẫu.</p>'}<div id="budget-rows"></div><button type="button" class="button button-small" data-action="add-budget-row">Thêm quỹ</button><p class="form-note">Liên kết tài khoản là nơi dự định giữ tiền; không tạo chuyển khoản. Tài khoản thực nhận được chọn riêng ở trên. Giữ tên và liên kết của quỹ đã có để cấp thêm vào cùng quỹ.</p><button type="button" class="button button-soft" data-action="preview-allocation">Xem trước phép chia</button><div id="allocation-preview" aria-live="polite"></div>`;
  renderBudgetRows();
}
function renderBudgetRows() {
  document.getElementById('budget-rows').innerHTML = allocationDraft.rows.map((row, index) => `<fieldset class="budget-row"><legend>Quỹ ${index + 1}</legend><div class="budget-row-fields">${field('Tên mục đích', `budget-name-${index}`, `<input id="budget-name-${index}" data-budget-index="${index}" data-budget-field="name" value="${safe(row.name)}" required maxlength="80">`)}${field('Quy tắc', `budget-kind-${index}`, `<select id="budget-kind-${index}" data-budget-index="${index}" data-budget-field="kind">${[['percent','Phần trăm sau cố định'],['fixed','Cố định mỗi lần áp dụng'],['remainder','Nhận phần dư']].map(([value,label]) => `<option value="${value}" ${row.kind === value ? 'selected' : ''}>${label}</option>`).join('')}</select>`)}${field(row.kind === 'percent' ? 'Tỷ lệ (%)' : 'Số tiền (VND)', `budget-value-${index}`, `<input id="budget-value-${index}" type="number" data-budget-index="${index}" data-budget-field="value" value="${safe(row.value)}" min="0" step="${row.kind === 'percent' ? '0.01' : '1'}" ${row.kind === 'remainder' ? 'disabled' : 'required'}>`)}${field('Tài khoản kế hoạch', `budget-account-${index}`, `<select id="budget-account-${index}" data-budget-index="${index}" data-budget-field="accountId">${options(state.accounts.filter(a => a.type === 'cash'), row.accountId, 'Chưa liên kết')}</select>`)}</div><button type="button" class="button button-text button-small" data-action="remove-budget-row" data-index="${index}">Bỏ quỹ ${index + 1}</button></fieldset>`).join('');
}
function invalidateAllocationPreview() {
  reviewedAllocationKey = '';
  const host = document.getElementById('allocation-preview');
  if (host) host.innerHTML = '<p class="form-note">Hãy xem trước lại sau khi đổi thông tin.</p>';
}
function addBudgetRow() { if (!allocationDraft || allocationDraft.rows.length >= 12) { showFormError('Tối đa 12 quỹ.'); return; } allocationDraft.rows.push(blankBudgetRow()); invalidateAllocationPreview(); renderBudgetRows(); }
function removeBudgetRow(index) { if (!allocationDraft || allocationDraft.rows.length <= 1) { showFormError('Giữ ít nhất một quỹ.'); return; } allocationDraft.rows.splice(index, 1); invalidateAllocationPreview(); renderBudgetRows(); }
function allocationAmount() { return Number(document.getElementById('allocation-amount')?.value ?? document.getElementById('amount')?.value); }
function allocationKey() { return JSON.stringify({ amount: allocationAmount(), rows: allocationDraft?.rows, incomeId: document.getElementById('allocation-form')?.dataset.incomeId || '', accountId: document.getElementById('accountId')?.value || '' }); }
function showAllocationPreview() {
  try {
    if (!allocationDraft) throw new Error('Chọn cách chia trước.');
    const amount = allocationAmount(), result = previewAllocation(amount, allocationDraft.rows, state);
    const total = result.lines.reduce((sum, line) => sum + line.amount, 0);
    const incomeId = document.getElementById('allocation-form')?.dataset.incomeId;
    const summary = getBudgetSummary(state);
    const income = summary.incomes.find(tx => tx.id === incomeId);
    if (income && amount > income.remaining) throw new Error('Nguồn chia vượt phần còn chưa phân của khoản thu này.');
    const capacity = income ? summary.cashAvailable : Math.max(0, summary.liquidCash + amount - summary.creditDebt - summary.totalRemaining);
    document.getElementById('allocation-preview').innerHTML = `<section class="allocation-preview"><h3>Kiểm tra trước khi xác nhận</h3><p><strong>Nguồn lần này: ${money(amount)}</strong></p><p>Cơ sở tính mọi tỷ lệ: ${money(amount)} − ${money(amount - result.base)} cố định thực cấp = <strong>${money(result.base)}</strong></p>${allocationDraft.rows.some(row => row.kind === 'fixed') ? '<div class="notice warn">Cố định là mỗi lần áp dụng. Nếu nhận thêm đợt thứ hai trong cùng tháng hoặc chia tiếp khoản này, khoản cố định chạy lại; không tự trừ số đã cấp trong tháng. Hãy sửa riêng lần này nếu cần.</div>' : ''}<div class="table-wrap"><table class="data-table"><thead><tr><th>Quỹ & quy tắc</th><th>Kế hoạch tài khoản</th><th>Số tiền</th></tr></thead><tbody>${result.lines.map(line => `<tr><td><strong>${safe(line.name)}</strong><small>${safe(line.rule)}</small></td><td>${line.accountId ? safe(accountName(line.accountId)) : 'Chưa liên kết'}</td><td>${money(line.amount)}</td></tr>`).join('')}</tbody></table></div><p>Đã chia: <strong>${money(total)}</strong> · chưa chia trong nguồn lần này: <strong>${money(result.unallocated)}</strong> · thiếu cố định lần này: <strong>${money(result.shortage)}</strong></p>${income ? `<p>Còn chưa phân của khoản thu sau lần này: ${money(income.remaining - total)}</p>` : ''}<p>Khả năng phân bổ thêm hiện tại${income ? '' : ' sau khi ghi thu'}: ${money(capacity)}. ${total > capacity ? '<strong class="negative">Chưa đủ nguồn để xác nhận; hãy giảm số chia.</strong>' : ''}</p><p>Liên kết chỉ lưu kế hoạch, không chuyển tiền hay trả nợ. Phân bổ không làm tăng tổng tài sản.</p></section>`;
    reviewedAllocationKey = allocationKey();
  } catch (error) { reviewedAllocationKey = ''; showFormError(error.message); }
}
function reviewedAllocation() {
  if (!allocationDraft || !reviewedAllocationKey || reviewedAllocationKey !== allocationKey()) throw new Error('Hãy bấm “Xem trước phép chia” với thông tin hiện tại trước khi xác nhận.');
  const result = previewAllocation(allocationAmount(), allocationDraft.rows, state);
  return { lines: result.lines, label: allocationDraft.label, templateId: allocationDraft.templateId, ruleSnapshot: cloneRows(allocationDraft.rows) };
}
async function saveTransactionForm(form, input) {
  const mode = new FormData(form).get('allocation-mode') || 'none';
  let next;
  if (input.kind === 'income' && mode !== 'none') next = createIncomeWithAllocation(state, input, reviewedAllocation());
  else {
    next = createTransaction(state, input);
    const fundId = String(new FormData(form).get('expense-fund') || '');
    if (input.kind === 'expense' && fundId) next = linkBudgetExpense(next, next.transactions.at(-1).id, fundId);
  }
  await persistAndRender(next, input.kind === 'income' && mode !== 'none' ? 'Ghi thu và phân bổ' : `Ghi ${kindLabels[input.kind].toLocaleLowerCase('vi-VN')}`);
}
function openLaterAllocation(incomeId) {
  const summary = getBudgetSummary(state), income = summary.incomes.find(tx => tx.id === incomeId);
  if (!income || income.remaining <= 0) return;
  const body = `<form id="allocation-form" data-income-id="${safe(incomeId)}"><div id="form-error"></div><p>${safe(txTitle(income))} · thực nhận ${money(income.amount)} vào ${safe(accountName(income.accountId))}</p><p>Còn chưa phân: ${money(income.remaining)} · nguồn có thể giao thêm mục đích hiện tại: ${money(summary.cashAvailable)}</p>${field('Phần thu muốn chia lần này (VND)', 'allocation-amount', input('allocation-amount', 'number', Math.min(income.remaining, summary.cashAvailable), `required min="1" max="${income.remaining}" step="1"`), true)}${field('Cách chia', 'allocation-mode', '<select id="allocation-mode"><option value="template">Áp mẫu</option><option value="custom">Tự chia lần này</option></select>', true)}<div id="allocation-panel"></div></form>`;
  openModal('Phân bổ phần còn lại', 'Không thêm giao dịch thu. Bạn có thể chỉ chia một phần và quay lại sau.', body, '<button type="button" class="button" data-action="close-modal">Hủy</button><button type="submit" form="allocation-form" class="button button-primary">Xác nhận phân bổ</button>');
  beginAllocationEditor();
}
function openTemplateEditor(templateId = '') {
  const source = getTemplates(state).find(t => t.id === templateId);
  allocationDraft = { rows: source ? cloneRows(source.rows) : [blankBudgetRow()], label: '', templateId: '' }; reviewedAllocationKey = '';
  openModal(source ? 'Tùy chỉnh bản sao' : 'Tạo mẫu từ đầu', 'Bản gốc không đổi. Mẫu mới được lưu cục bộ để dùng lại sau khi tải lại.', `<form id="template-form"><div id="form-error"></div>${field('Tên mẫu riêng', 'templateName', input('templateName', 'text', source ? `${source.name} của tôi` : '', 'required maxlength="80"'), true)}<p>Cố định áp mỗi lần dùng mẫu, không phải mục tiêu tháng. Tỷ lệ cùng tính trên phần còn sau tất cả khoản cố định; chỉ một quỹ nhận phần dư.</p><div id="budget-rows"></div><button type="button" class="button button-small" data-action="add-budget-row">Thêm quỹ</button><p class="form-note">Liên kết tài khoản chỉ là kế hoạch, không chuyển tiền. Từ 1 đến 12 quỹ; lưu mẫu không ghi thu hoặc chia tiền.</p></form>`, '<button type="button" class="button" data-action="close-modal">Hủy</button><button type="submit" form="template-form" class="button button-primary">Lưu mẫu của tôi</button>');
  renderBudgetRows();
}
function renderData() {
  const summary = backupSummary(state);
  return `${intro('Giữ bản sao trong tay bạn.', 'Sổ cá nhân được lưu cục bộ dạng rõ (plaintext), chưa mã hóa. Không có đăng nhập, ngân hàng hoặc đồng bộ đám mây.')}
  <div class="notice warn">Dữ liệu gắn với trình duyệt và địa chỉ mở ứng dụng. Xóa dữ liệu trình duyệt, chế độ riêng tư hoặc đổi địa chỉ có thể làm mất/không thấy sổ. Ghi dữ liệu cần trình duyệt hỗ trợ Web Locks (localhost/HTTPS hoặc file khi trình duyệt cho phép); nếu thiếu, ứng dụng chặn ghi và vẫn cho xuất bản sao. File JSON chứa toàn bộ dữ liệu riêng; hãy giữ ở nơi bạn kiểm soát. Bản thử bắt đầu với dữ liệu giả, chỉ dùng dữ liệu thử nghiệm.</div>
  <section class="card template-card budget-section"><h3>Xuất và khôi phục sổ cá nhân</h3><p>${summary.transactions} giao dịch · ${summary.accounts} tài khoản · ${summary.assets} tài sản · ${summary.templates} mẫu riêng · ${summary.allocations} lần phân bổ</p><div class="toolbar-actions"><button class="button button-primary" data-action="export-json">Xuất bản sao JSON</button><button class="button" data-action="export-csv">Xuất giao dịch CSV</button><button class="button" data-action="restore-json">Xem trước khôi phục JSON</button></div><p class="form-note">JSON giữ cả mẫu, quỹ, lịch và hoàn tác. CSV chỉ xuất giao dịch; không phải bản sao toàn sổ. Sổ chung mô phỏng tách biệt và không nằm trong bản sao cá nhân.</p></section>
  <section class="card template-card budget-section"><h3>Hoàn tác thao tác mới nhất</h3><p>Chỉ một thao tác mới nhất, gồm toàn bộ thay đổi của lần ghi đó. Sau hoàn tác không có redo hoặc hoàn tác tiếp lịch sử cũ.</p><button class="button" data-action="undo-change" ${state.undoPoint ? '' : 'disabled'}>${state.undoPoint ? `Hoàn tác: ${safe(state.undoPoint.label)}` : 'Chưa có thao tác để hoàn tác'}</button></section>
  <section class="card template-card budget-section"><h3>Lịch sử cục bộ</h3><p>Giữ tối đa 100 mục gần nhất; không phải nhật ký kiểm toán độc lập.</p>${[...(state.activity || [])].reverse().map(entry => `<div class="list-row"><span class="list-body"><strong>${safe(entry.label)}</strong><small>${safe(entry.at)}</small></span></div>`).join('') || '<p>Chưa có thay đổi đã ghi trong phiên bản này.</p>'}</section>`;
}
function downloadText(text, filename, type = 'application/json;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function downloadCurrentBackup() {
  try { downloadText(exportBackup(state), 'mach-tien-backup.json'); restoreExportedState = JSON.stringify(state); toast('Đã yêu cầu tải bản sao. Hãy kiểm tra tệp trong thư mục tải xuống.'); }
  catch (error) { toast(error.message, 'error'); }
}
function openRestoreModal() {
  restoreDraft = null; restoreExportedState = null;
  openModal('Khôi phục từ JSON', 'Chỉ đọc và kiểm tra trước; chưa thay đổi sổ. Tối đa 5 MiB.', '<form id="restore-form"><div id="form-error"></div><label for="restore-file">Chọn bản sao JSON</label><input id="restore-file" type="file" accept=".json,application/json" required><div id="restore-preview"></div></form>', '<button type="button" class="button" data-action="close-modal">Hủy</button><button type="submit" form="restore-form" class="button button-primary">Đọc và xem trước</button>');
}
async function previewRestore(form) {
  restoreDraft = null; restoreExportedState = null;
  const file = form.querySelector('#restore-file').files?.[0];
  if (!file || file.size > 5 * 1024 * 1024) throw new Error('Chọn tệp JSON không quá 5 MiB.');
  const requestToken = ++pendingReadRevision, modalToken = modalRevision;
  const text = await file.text();
  if (modalToken !== modalRevision || requestToken !== pendingReadRevision) return;
  const candidate = parseBackup(text);
  const old = backupSummary(state), next = backupSummary(candidate);
  const labels = { transactions: 'Giao dịch', accounts: 'Tài khoản', assets: 'Tài sản', templates: 'Mẫu riêng', allocations: 'Lần phân bổ', netWorth: 'Tài sản ròng', liquidCash: 'Tiền mặt/ngân hàng' };
  document.getElementById('restore-preview').innerHTML = `<h3>Bản sao hợp lệ · chưa thay sổ</h3><div class="table-wrap"><table class="data-table"><thead><tr><th></th><th>Hiện tại</th><th>Sau khôi phục</th></tr></thead><tbody>${Object.entries(labels).map(([key, label]) => `<tr><td>${label}</td><td>${key === 'netWorth' || key === 'liquidCash' ? money(old[key]) : old[key]}</td><td>${key === 'netWorth' || key === 'liquidCash' ? money(next[key]) : next[key]}</td></tr>`).join('')}</tbody></table></div><p>Thay toàn bộ sổ cá nhân, không gộp hai sổ. Lịch sử cục bộ ghi thao tác khôi phục; hoàn tác mới nhất giữ sổ hiện tại.</p><button type="button" class="button" data-action="export-json">1. Xuất sổ hiện tại trước khi thay</button><label class="restore-ack"><input type="checkbox" id="restore-ack"> 2. Tôi đã kiểm tra tệp sao lưu hiện tại đã tải được và hiểu sổ sẽ bị thay thế</label><button type="button" class="button button-danger" data-action="confirm-restore">3. Xác nhận thay toàn bộ sổ</button>`;
  restoreDraft = candidate;
}
async function confirmRestore() {
  try {
    if (!restoreDraft || restoreExportedState !== JSON.stringify(state) || !document.getElementById('restore-ack')?.checked) throw new Error('Hãy xuất bản sao sổ hiện tại và xác nhận đã kiểm tra tệp trước khi thay thế.');
    if (!window.confirm('Thay toàn bộ sổ cá nhân bằng bản sao đã xem trước? Đây không phải thao tác gộp.')) return;
    await persistAndRender(restoreDraft, 'Khôi phục bản sao JSON'); closeModal(); toast('Đã khôi phục sổ. Có thể hoàn tác thao tác mới nhất ở mục Dữ liệu.');
  } catch (error) { showFormError(error.message); }
}
async function performUndo() {
  try {
    if (!state.undoPoint || !window.confirm(`Hoàn tác toàn bộ thao tác “${state.undoPoint.label}”? Chỉ thao tác mới nhất có thể hoàn tác.`)) return;
    const candidate = undoChange(state);
    if (writeBusy) throw new Error('Đang lưu thao tác trước, hãy đợi.');
    writeBusy = true;
    try { await saveState(candidate); state = candidate; render(); } finally { writeBusy = false; }
    toast('Đã hoàn tác thao tác mới nhất.');
  } catch (error) { toast(error.message, 'error'); }
}

document.addEventListener('click', async event => {
  if (writeBusy) { toast('Đang lưu thao tác trước, hãy đợi.', 'error'); return; }
  if (storageError) {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'download-backup') {
      try {
        const raw = globalThis.localStorage.getItem(storageKey);
        if (!raw) throw new Error('Không tìm thấy dữ liệu cũ.');
        const url = URL.createObjectURL(new Blob([raw], { type: 'text/plain;charset=utf-8' }));
        const link = document.createElement('a'); link.href = url; link.download = 'mach-tien-du-lieu-cu.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
        toast('Đã tải bản sao dữ liệu cũ.');
      } catch (error) { toast(error.message || 'Không thể tải bản sao.', 'error'); }
    } else if (action === 'reset-demo') {
      if (window.confirm('Đặt lại dữ liệu mẫu? Dữ liệu cũ trên trình duyệt này sẽ bị xóa. Hãy tải bản sao trước nếu bạn cần giữ lại.')) {
        try { state = await resetState(); storageError = null; view = 'dashboard'; render(); toast('Đã đặt lại dữ liệu mẫu.'); }
        catch (error) { toast(error.message || 'Không thể đặt lại.', 'error'); }
      }
    } else toast('Dữ liệu cũ đang cần khôi phục; ứng dụng đã dừng ghi.', 'error');
    return;
  }
  const nav = event.target.closest('[data-view]'); if (nav) { setView(nav.dataset.view); return; }
  const filter = event.target.closest('[data-filter]'); if (filter) { txFilter = filter.dataset.filter; render(); return; }
  const action = event.target.closest('[data-action]'); if (!action) return;
  if (action.dataset.action === 'close-modal-backdrop' && event.target !== action) return;
  switch (action.dataset.action) {
    case 'add-transaction': openTransactionModal(); break;
    case 'use-template': openTransactionModal(action.dataset.id); break;
    case 'copy-template': openTemplateEditor(action.dataset.id); break;
    case 'new-template': openTemplateEditor(); break;
    case 'allocate-income': openLaterAllocation(action.dataset.id); break;
    case 'add-budget-row': addBudgetRow(); break;
    case 'remove-budget-row': removeBudgetRow(Number(action.dataset.index)); break;
    case 'preview-allocation': showAllocationPreview(); break;
    case 'export-json': downloadCurrentBackup(); break;
    case 'export-csv': downloadText(exportTransactionsCsv(state), 'mach-tien-giao-dich.csv', 'text/csv;charset=utf-8'); break;
    case 'restore-json': openRestoreModal(); break;
    case 'confirm-restore': await confirmRestore(); break;
    case 'undo-change': await performUndo(); break;
    case 'add-account': openAccountModal(); break;
    case 'import-selected-duplicates': {
      if (!pendingImportCsv) break;
      const selectedRows = [...document.querySelectorAll('#import-result .duplicate-row:checked')].map(input => Number(input.value)).filter(Number.isInteger);
      if (!selectedRows.length) { showFormError('Chọn ít nhất một dòng nghi trùng mà bạn đã kiểm tra.'); break; }
      try {
        const result = importTransactionsCsv(state, pendingImportCsv, { allowDuplicateRows: selectedRows });
        if (Number(result.imported) > 0) await persistAndRender(result.state, 'Nhập giao dịch CSV'); pendingImportCsv = null;
        document.getElementById('import-result').innerHTML = `<div class="import-result">Đã nhập <strong>${result.imported}</strong> dòng bạn xác nhận. Các dòng khác không thay đổi.${result.errors?.length ? `<div class="import-messages">${result.errors.map(e => `<p>Dòng ${Number(e.row)}: ${safe(e.message)}</p>`).join('')}</div>` : ''}</div>`;
        toast(`Đã nhập ${result.imported} dòng đã chọn.`);
      } catch (error) { showFormError(error.message || 'Không thể nhập các dòng đã chọn.'); }
      break;
    }
    case 'update-asset': openAssetModal(action.dataset.id); break;
    case 'add-plan': openPlanModal(); break;
    case 'import-csv': openImportModal(); break;
    case 'close-modal': case 'close-modal-backdrop': closeModal(); break;
    case 'reset-demo':
      if (window.confirm('Đặt lại dữ liệu mẫu? Sổ hiện tại sẽ được thay thế; có thể hoàn tác thao tác này trước khi ghi thao tác khác.')) { try { await persistAndRender(createDemoState(), 'Đặt lại dữ liệu mẫu'); txSearch = ''; txFilter = 'all'; setView('dashboard'); toast('Đã đặt lại dữ liệu mẫu.'); } catch (error) { toast(error.message, 'error'); } }
      break;
  }
});
document.addEventListener('change', event => {
  if (['csv-file', 'restore-file'].includes(event.target.id)) pendingReadRevision++;
  if (event.target.id === 'allocation-mode') beginAllocationEditor();
  if (event.target.id === 'budget-template') beginAllocationEditor(event.target.value);
  if (event.target.dataset.budgetField) {
    updateBudgetField(event.target);
    if (event.target.dataset.budgetField === 'kind') renderBudgetRows();
  }
  if (['amount','allocation-amount','accountId','kind'].includes(event.target.id)) invalidateAllocationPreview();
  if (event.target.id === 'kind') allocationDraft = null;
  if (event.target.id === 'restore-file') { restoreDraft = null; restoreExportedState = null; document.getElementById('restore-preview').innerHTML = ''; }
  if (event.target.id === 'type' && event.target.closest('#account-form')) {
    document.getElementById('account-card-fields').innerHTML = event.target.value === 'credit' ? accountCardFields() : '';
    document.querySelector('label[for="openingBalance"]').textContent = event.target.value === 'credit' ? 'Dư nợ đầu kỳ (VND)' : 'Số dư đầu kỳ (VND)';
  }
  if (event.target.id === 'kind' && event.target.closest('#transaction-form')) document.getElementById('transaction-fields').innerHTML = transactionFields(event.target.value);
  if (event.target.id === 'toAccountId' && event.target.closest('#transaction-form')) {
    const el = document.getElementById('planId'); if (el) el.innerHTML = options(cardPlanOptions(event.target.value), '', 'Không gắn với lịch');
  }
});
function updateBudgetField(target) {
  if (!allocationDraft) return;
  const row = allocationDraft.rows[Number(target.dataset.budgetIndex)];
  if (!row) return;
  row[target.dataset.budgetField] = target.dataset.budgetField === 'value' ? Number(target.value) : target.value;
  if (target.dataset.budgetField === 'kind' && target.value === 'remainder') row.value = 0;
  invalidateAllocationPreview();
}
document.addEventListener('input', event => {
  if (event.target.id === 'csv-text') pendingReadRevision++;
  if (event.target.dataset.budgetField) updateBudgetField(event.target);
  if (['amount','allocation-amount','accountId'].includes(event.target.id)) invalidateAllocationPreview();
  if (event.target.id === 'tx-search') {
    txSearch = event.target.value;
    document.getElementById('transactions-body').innerHTML = transactionRows();
    document.getElementById('transactions-count').textContent = `Hiển thị ${filteredTransactions().length} giao dịch`;
  }
});
document.addEventListener('submit', handleSubmit);
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !writeBusy) closeModal(); });
render();
