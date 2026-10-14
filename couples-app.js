import { createSpace, applyCommand, summary } from './couples.js';

// Intentionally ephemeral. Actor selection is a demo control, NOT authentication.
const TODAY = '2026-10-15';
const CURRENT_MONTH = TODAY.slice(0, 7);
const names = { A: 'Người A', B: 'Người B' };
const titles = { space: 'Không gian chung', agreement: 'Thỏa thuận tháng', ledger: 'Sổ chung', plans: 'Kế hoạch chung', close: 'Chốt tháng' };
const kindNames = { contribution: 'Góp vào quỹ', expense: 'Chi từ quỹ', advance: 'Ứng tiền riêng', reimbursement: 'Nhận hoàn ứng' };
let state = null;
let actor = 'A';
let month = CURRENT_MONTH;
let view = 'space';
let sequence = 0;
const root = document.querySelector('#workspace');
const status = document.querySelector('#status-message');
const moneyFormat = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 });
const money = value => moneyFormat.format(value || 0);
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const id = prefix => `${prefix}-${++sequence}`;
const person = value => names[value] || 'Thành viên demo';
const formatDate = value => value.split('-').reverse().join('/');
const monthLabel = value => `${value.slice(5)}/${value.slice(0, 4)}`;
const nextMonth = value => { const date = new Date(`${value}-01T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() + 1); return date.toISOString().slice(0, 7); };
const closedThrough = value => state?.closes.some(item => item.status === 'closed' && item.month >= value);
const member = () => state?.members.includes(actor);
const ready = () => member() && state.members.length === 2;
const summaryNow = () => summary(state, month);
const approvals = values => ['A', 'B'].map(value => `${person(value)}: ${values.includes(value) ? 'đã đồng ý' : 'chưa đồng ý'}`).join(' · ');
const note = (text, warning = false) => `<div class="callout${warning ? ' warning' : ''}">${text}</div>`;
const empty = (title, text, action = '') => `<div class="empty"><div class="empty-mark" aria-hidden="true">＋</div><h3>${title}</h3><p>${text}</p>${action}</div>`;
const goButton = (target, label, primary = false) => `<button class="button ${primary ? 'primary' : 'soft'}" type="button" data-go="${target}">${label}</button>`;
const moneyInput = (key, label, extra = '') => `<div class="field"><label for="${key}">${label}</label><input id="${key}" name="${key}" type="number" min="1" max="1000000000000" step="1" inputmode="numeric" required ${extra}></div>`;
const consent = (key, text) => `<label class="consent" for="${key}"><input id="${key}" name="${key}" type="checkbox" required><span>${text}</span></label>`;
const errorSlot = '<div class="form-error" role="alert" hidden></div>';
const introduction = (title, text, badge = '') => `<div class="intro"><div><h2>${title}</h2><p>${text}</p></div>${badge}</div>`;

function notify(message, error = false) {
  status.textContent = message;
  status.classList.toggle('error', error);
  status.hidden = false;
}
function clearMessage() { status.textContent = ''; status.hidden = true; }
function mutate(command) { state = applyCommand(state, actor, command, TODAY); }
function render() {
  document.querySelector('#page-title').textContent = titles[view];
  document.querySelector('#actor-select').value = actor;
  document.querySelector('#month-select').value = month;
  document.querySelectorAll('[data-view]').forEach(button => {
    button.classList.toggle('active', button.dataset.view === view);
    if (button.dataset.view === view) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  if (!state) root.innerHTML = renderStart();
  else if (!member()) root.innerHTML = renderInvitee();
  else if (view === 'space') root.innerHTML = renderSpace();
  else if (!ready()) root.innerHTML = renderGate();
  else root.innerHTML = ({ agreement: renderAgreement, ledger: renderLedger, plans: renderPlans, close: renderClose })[view]();
}

function renderStart() {
  return introduction('Một sổ chung, hai lời đồng ý', 'Thử quản lý phần tài chính hai người chủ động chia sẻ. Không nhập lương, không tự chia đôi, không kết nối sổ cá nhân.', '<span class="pill">Bắt đầu từ số 0</span>') + `<div class="grid two">
    <section class="card hero"><p class="eyebrow">CÙNG XÂY DỰNG THÓI QUEN</p><h2>Tiền chung rõ ràng.<br>Chuyện riêng tôn trọng.</h2><p>Hai người tự thống nhất phần đóng góp, ghi lại chi tiêu chung và cùng xem lại cuối tháng.</p><div class="hero-meta"><span>Ngày mô phỏng cố định</span><b>${formatDate(TODAY)}</b></div></section>
    <section class="card"><div class="card-header"><div><h3>Tạo không gian demo</h3><p>Bạn đang đóng vai ${person(actor)}. Bước tiếp theo là mời người còn lại.</p></div></div>
      <form class="form" data-form="create">${errorSlot}<div class="field"><label for="space-name">Tên không gian</label><input id="space-name" name="name" value="Nhà mình" maxlength="80" required autocomplete="off"><small>Chỉ dùng tên giả hoặc tên không chứa thông tin cá nhân.</small></div>
      ${consent('create-consent', 'Tôi hiểu đây là mô phỏng. Tôi đồng ý tạo sổ chung; các mục nhập vào sổ này sẽ được cả hai danh tính demo xem sau khi tham gia.')}
      <button class="button primary" type="submit">Tạo không gian chung</button></form></section>
    </div><section class="card section-gap"><div class="card-header"><h3>5 bước có thể thử</h3><span class="quiet">Không cần tài khoản</span></div><ol class="step-list"><li><span><strong>Tạo và tham gia:</strong> chuyển A/B để thử lời mời và đồng ý rõ phạm vi chia sẻ.</span></li><li><span><strong>Thống nhất tháng:</strong> chọn số tiền cố định hoặc tỷ lệ do hai người tự nhập.</span></li><li><span><strong>Ghi sổ chung:</strong> góp quỹ, chi chung, ứng trước và hoàn ứng.</span></li><li><span><strong>Lập kế hoạch:</strong> theo dõi ngân sách, hóa đơn và một mục tiêu chung.</span></li><li><span><strong>Cùng chốt:</strong> hai người xác nhận, khóa kỳ và chuyển số dư sang tháng sau.</span></li></ol></section>`;
}
function renderInvitee() {
  const invitation = state.invite;
  if (!invitation || invitation.invitee !== actor) {
    return introduction('Chưa có lời mời cho bạn', 'Danh tính này chưa tham gia không gian. Chủ không gian cần tạo lời mời demo trước.') + `<section class="card">${empty('Chờ một lời mời', `Chuyển sang ${person(state.members[0])} bằng ô Danh tính demo để tạo lời mời. Nội dung sổ chung chưa được hiển thị ở vai hiện tại.`)}${note('Ẩn nội dung theo vai chỉ mô phỏng luồng tham gia. Hai vai dùng chung bộ nhớ trình duyệt, không có xác thực hay cách ly bảo mật.', true)}</section>`;
  }
  return introduction('Bạn được mời vào sổ chung', `${person(state.members[0])} mời ${person(actor)} tham gia “${esc(state.name)}”.`, '<span class="pill pending">Cần sự đồng ý của bạn</span>') + `<div class="grid two"><section class="card"><h3>Phạm vi chia sẻ</h3><ul class="step-list"><li><span>Cả hai xem được thỏa thuận, giao dịch, hóa đơn, mục tiêu và bản chốt trong không gian này.</span></li><li><span>Không tự đọc hoặc chia sẻ thu nhập, tài khoản, giao dịch hay tài sản trong sổ cá nhân.</span></li><li><span>Bạn chỉ tham gia khi tích đồng ý và xác nhận. Lời mời là mô phỏng, không gửi email hoặc thông báo thật.</span></li></ul>${note('Không nhập dữ liệu thật. Chuyển danh tính không phải đăng nhập và không ngăn người dùng cùng trình duyệt xem dữ liệu.', true)}</section>
    <section class="card"><div class="card-header"><div><h3>Chấp nhận lời mời demo</h3><p>Hết hạn ${formatDate(invitation.expires)} · Ngày mô phỏng ${formatDate(TODAY)}</p></div></div><form class="form" data-form="accept">${errorSlot}<div class="field"><label for="invite-code">Mã lời mời demo</label><input id="invite-code" name="token" value="${esc(invitation.token)}" required maxlength="200" autocomplete="off"><small>Mã hiển thị ngay trong bản demo; không phải bí mật xác thực.</small></div>${consent('join-consent', 'Tôi đồng ý tham gia và chia sẻ các mục trong sổ chung với người còn lại. Tôi hiểu các giới hạn mô phỏng nêu trên.')}<button class="button primary" type="submit">Đồng ý tham gia</button></form></section></div>`;
}
function renderGate() {
  return introduction('Cần hai người cùng tham gia', 'Chưa thể ghi giao dịch hoặc thỏa thuận khi người còn lại chưa đồng ý.') + `<section class="card">${empty('Hoàn thành lời mời trước', 'Mở Không gian chung, tạo lời mời rồi chuyển danh tính để chấp nhận.', goButton('space', 'Mở không gian chung', true))}</section>`;
}
function renderSpace() {
  const joined = ready();
  const other = state.members[0] === 'A' ? 'B' : 'A';
  const info = joined ? summaryNow() : null;
  return introduction(esc(state.name), 'Sổ chung chỉ chứa những gì hai người chủ động ghi ở đây. Ngày mô phỏng cố định: 15/10/2026.', `<span class="pill${joined ? '' : ' pending'}">${joined ? 'Hai người đã tham gia' : 'Chờ người còn lại'}</span>`) + `<div class="grid two"><section class="card hero"><p class="eyebrow">${joined ? `QUỸ CHUNG ĐẾN THÁNG ${monthLabel(month)}` : 'KHÔNG GIAN ĐÃ SẴN SÀNG'}</p><h2>${joined ? 'Để tiền chung dễ nói hơn' : 'Một lời mời.<br>Một bước cùng nhau.'}</h2>${joined ? `<div class="hero-amount">${money(info.cash)}</div><p>Số dư ghi sổ cộng dồn, đã gồm tiền tháng trước. Chưa trừ các khoản ứng trước cần hoàn.</p>${goButton('ledger', 'Mở sổ chung')}` : '<p>Người còn lại cần xem phạm vi chia sẻ và chủ động đồng ý trước khi bắt đầu ghi sổ.</p>'}<div class="hero-meta"><span>Chỉ đơn vị VND</span><b>${joined ? 'Không kết nối ngân hàng' : 'Không gửi lời mời thật'}</b></div></section>
    <section class="card"><div class="card-header"><h3>Hai người trong không gian</h3><span class="quiet">${state.members.length}/2 đã tham gia</span></div>${['A', 'B'].map(value => `<div class="people"><div class="avatar ${value === 'B' ? 'b' : ''}">${value}</div><div class="person"><strong>${person(value)}${value === actor ? ' · Vai hiện tại' : ''}</strong><small>${state.members.includes(value) ? 'Đã đồng ý tham gia' : state.invite?.invitee === value ? 'Có lời mời, chưa đồng ý' : 'Chưa có lời mời'}</small></div></div>`).join('')}
      ${joined ? note('Cả hai cùng xem sổ chung. Để thử bước xác nhận của người còn lại, đổi Danh tính demo ở đầu trang.') : state.invite ? `<div class="callout">Đã tạo lời mời cho ${person(other)}. Mã demo: <strong>${esc(state.invite.token)}</strong><br>Chuyển sang ${person(other)} để đọc và chấp nhận. Hết hạn ${formatDate(state.invite.expires)}.</div><button class="button small danger" type="button" data-action="revoke">Thu hồi lời mời demo</button>` : `<form class="form" data-form="invite">${errorSlot}${consent('invite-consent', `Tôi muốn mời ${person(other)} và chia sẻ các mục trong không gian này khi người đó đồng ý.`)}<button class="button primary" type="submit">Tạo lời mời cho ${person(other)}</button></form>`}
    </section></div>
    ${joined ? `<div class="metrics section-gap"><article class="metric"><span>Chi chung tháng này</span><strong>${money(info.spent)}</strong><small>Gồm chi quỹ và ứng tiền riêng</small></article><article class="metric"><span>Còn cần hoàn ứng</span><strong>${money((info.advances.A || 0) + (info.advances.B || 0))}</strong><small>Cộng dồn đến tháng đang xem</small></article><article class="metric"><span>Ngân sách thống nhất</span><strong>${info.plan ? money(info.budget) : 'Chưa có'}</strong><small>${info.plan ? 'Đã được hai người đồng ý' : 'Không áp sẵn số tiền hoặc tỷ lệ'}</small></article></div><section class="card"><h3>Đi tiếp từ đây</h3><p>${info.plan ? 'Ghi lại phần góp và các khoản chi chung, sau đó cùng kiểm tra cuối tháng.' : 'Bắt đầu bằng một ngân sách và phần đóng góp mà cả hai đều thấy phù hợp.'}</p><div class="actions">${goButton('agreement', 'Thỏa thuận đóng góp', !info.plan)}${goButton('ledger', 'Ghi giao dịch')}${goButton('plans', 'Hóa đơn & mục tiêu')}${goButton('close', 'Xem bản chốt')}</div></section>` : `<section class="card section-gap"><h3>Phần riêng chưa được đưa vào đây</h3><p>Không gian này không đọc lương, giao dịch, số dư hoặc tài sản của sổ cá nhân. Bản demo chỉ minh họa luồng hai người đồng ý và quản lý sổ chung.</p>${note('Sổ cá nhân và sổ chung dùng giao diện riêng; đây không phải cam kết cách ly bảo mật của một sản phẩm có tài khoản thật.', true)}</section>`}`;
}
function renderAgreement() {
  const info = summaryNow();
  const pending = state.plans.filter(plan => plan.status === 'pending');
  const earliest = state.plans.some(plan => plan.status === 'active') ? nextMonth(CURRENT_MONTH) : CURRENT_MONTH;
  const defaultMonth = month >= earliest ? month : earliest;
  return introduction('Một thỏa thuận do hai người chọn', 'Không yêu cầu công khai lương. Không mặc định chia đôi. Số tiền dự kiến chỉ có hiệu lực khi cả hai đồng ý.', '<span class="pill">Tự chọn cách đóng góp</span>') + `<div class="grid two"><div class="stack"><section class="card"><div class="card-header"><div><h3>Đang áp dụng · ${monthLabel(month)}</h3><p>${info.plan ? `Từ tháng ${monthLabel(info.plan.month)}; tiếp tục đến khi có thỏa thuận mới.` : 'Chưa có thỏa thuận được hai người xác nhận.'}</p></div></div>${info.plan ? planDetails(info.plan) : empty('Chưa chọn phần đóng góp', 'Một người đề xuất ở biểu mẫu bên cạnh, người còn lại xem và đồng ý.')} </section>
    ${pending.map(plan => `<section class="card"><div class="card-header"><h3>Đề xuất cho tháng ${monthLabel(plan.month)}</h3><span class="pill pending">Chờ xác nhận</span></div>${planDetails(plan)}<p class="quiet">${approvals(plan.approvals)}</p>${plan.approvals.includes(actor) ? note('Bạn đã đồng ý đề xuất này. Chuyển sang danh tính còn lại để xem và xác nhận.') : `<form class="form" data-form="approve-plan" data-id="${esc(plan.id)}">${errorSlot}${consent(`approve-${plan.id}`, 'Tôi đã xem ngân sách, cách chia và tháng áp dụng. Tôi đồng ý với đề xuất này.')}<button class="button primary" type="submit">Đồng ý thỏa thuận</button></form>`}</section>`).join('')}</div>
    <section class="card"><div class="card-header"><div><h3>Đề xuất thỏa thuận</h3><p>Thay đổi một thỏa thuận đã có chỉ áp dụng từ tháng tương lai.</p></div></div><form class="form" data-form="plan">${errorSlot}<div class="fields"><div class="field"><label for="plan-month">Tháng bắt đầu</label><input id="plan-month" name="month" type="month" min="${earliest}" value="${defaultMonth}" required></div>${moneyInput('budget', 'Ngân sách chung mỗi tháng (VND)')}<div class="field full"><label for="plan-mode">Cách xác định phần góp</label><select id="plan-mode" name="mode"><option value="fixed">Số tiền cố định mỗi người</option><option value="ratio">Tỷ lệ hai người tự thống nhất</option></select></div><div class="field"><label for="value-a" id="value-a-label">Phần Người A (VND)</label><input id="value-a" name="valueA" type="number" min="0" step="1" inputmode="numeric" required><small id="value-a-help">Nhập số tiền đã trao đổi, có thể bằng 0.</small></div><div class="field"><label for="value-b" id="value-b-label">Phần Người B (VND)</label><input id="value-b" name="valueB" type="number" min="0" step="1" inputmode="numeric" required><small id="value-b-help">Hai phần phải bằng ngân sách chung.</small></div></div>${consent('plan-consent', `Tôi, ${person(actor)}, đồng ý với phần góp và ngân sách đang đề xuất. Người còn lại vẫn cần xác nhận riêng.`)}<button class="button primary" type="submit">Gửi đề xuất demo</button>${note('Thỏa thuận không tự chuyển tiền. Mỗi khoản góp thực tế cần được ghi riêng trong Sổ chung. Với tỷ lệ, phần A làm tròn xuống đến 1 đồng; phần B nhận phần còn lại.')}</form></section></div>`;
}
function planDetails(plan) {
  return `<p class="quiet">Ngân sách chung <strong>${money(plan.budget)}</strong> · ${plan.mode === 'fixed' ? 'Số tiền cố định' : `Tỷ lệ ${plan.values[0]}% / ${plan.values[1]}%`}</p><div class="rule-detail"><div><span>Người A dự kiến góp</span><strong>${money(plan.expected[0])}</strong></div><div><span>Người B dự kiến góp</span><strong>${money(plan.expected[1])}</strong></div></div>`;
}
function advanceOptions() {
  return state.entries.filter(entry => entry.kind === 'advance' && entry.actor === actor).map(entry => ({ ...entry, remaining: entry.amount - state.entries.filter(item => item.advanceId === entry.id).reduce((total, item) => total + item.amount, 0) })).filter(entry => entry.remaining > 0);
}
function renderLedger() {
  const info = summaryNow();
  const entries = state.entries.filter(entry => entry.date.startsWith(month)).slice().reverse();
  const isClosed = closedThrough(month);
  return introduction('Ghi đúng dòng tiền, dễ hiểu phần chung', 'Góp quỹ tăng tiền chung. Ứng trước ghi khoản cần hoàn. Hoàn ứng giảm quỹ, không tính lại chi tiêu.', `<span class="pill${isClosed ? ' closed' : ''}">${monthLabel(month)} · ${isClosed ? 'Đã khóa sổ' : 'Đang mở'}</span>`) + `<div class="metrics"><article class="metric"><span>Quỹ chung cuối kỳ xem</span><strong>${money(info.cash)}</strong><small>Cộng dồn cả số dư tháng trước</small></article><article class="metric"><span>Chi chung tháng này</span><strong>${money(info.spent)}</strong><small>Chi quỹ + ứng trước</small></article><article class="metric"><span>Ứng trước chưa hoàn</span><strong>${money((info.advances.A || 0) + (info.advances.B || 0))}</strong><small>A: ${money(info.advances.A)} · B: ${money(info.advances.B)}</small></article></div><div class="grid two"><section class="card"><div class="card-header"><div><h3>Giao dịch tháng ${monthLabel(month)}</h3><p>Người ghi và số tiền được hiển thị cho cả hai.</p></div><span class="pill">${entries.length} mục</span></div>${entries.length ? `<div class="table-wrap"><table class="ledger-table"><caption class="sr-only">Các giao dịch chung tháng ${monthLabel(month)}</caption><thead><tr><th scope="col">Ngày</th><th scope="col">Loại / người ghi</th><th scope="col">Ghi chú</th><th scope="col">Số tiền</th></tr></thead><tbody>${entries.map(entry => `<tr><td>${formatDate(entry.date)}</td><td>${kindNames[entry.kind]}<br><span class="quiet">${person(entry.actor)}</span></td><td class="note">${esc(entry.note || 'Không có ghi chú')}${entry.billId ? '<br><span class="tag">Gắn hóa đơn</span>' : ''}</td><td>${money(entry.amount)}</td></tr>`).join('')}</tbody></table></div>` : empty('Tháng này chưa có giao dịch', 'Bắt đầu bằng một khoản góp quỹ hoặc khoản chi bằng tiền ứng trước.')} ${note('Bản demo chưa hỗ trợ sửa/xóa giao dịch. Kiểm tra kỹ trước khi ghi. Tải lại trang sẽ xóa toàn bộ dữ liệu của lần thử này.')}</section>
    <section class="card"><div class="card-header"><div><h3>Ghi một khoản chung</h3><p>Danh tính đang ghi: <strong>${person(actor)}</strong> · Ngày mô phỏng 15/10/2026</p></div></div>${isClosed ? empty('Kỳ đã được khóa', 'Hai người đã chốt tháng này hoặc một tháng sau đó. Chọn tháng đang mở để ghi thêm.') : `<form class="form" data-form="entry">${errorSlot}<div class="field"><label for="entry-kind">Loại giao dịch</label><select id="entry-kind" name="kind"><option value="contribution">Góp tiền vào quỹ chung</option><option value="expense">Chi bằng quỹ chung</option><option value="advance">Ứng tiền riêng cho chi chung</option><option value="reimbursement">Nhận hoàn ứng từ quỹ chung</option></select><small id="entry-help">Ghi tiền ${person(actor)} thực tế đã đưa vào quỹ chung. Không phải thu nhập cá nhân.</small></div><div class="fields">${moneyInput('entry-amount', 'Số tiền (VND)')}<div class="field"><label for="entry-date">Ngày ghi nhận</label><input id="entry-date" name="date" type="date" max="${TODAY}" value="${month <= CURRENT_MONTH ? `${month}-15` : TODAY}" required></div></div><div class="field" id="bill-field" hidden><label for="entry-bill">Thanh toán hóa đơn (không bắt buộc)</label><select id="entry-bill" name="billId"><option value="">Không gắn hóa đơn</option>${state.bills.map(bill => { const paid = state.entries.filter(entry => entry.billId === bill.id).reduce((total, entry) => total + entry.amount, 0); return bill.amount > paid ? `<option value="${esc(bill.id)}">${esc(bill.title)} · còn ${money(bill.amount - paid)}</option>` : ''; }).join('')}</select></div><div class="field" id="advance-field" hidden><label for="entry-advance">Khoản ${person(actor)} được hoàn</label><select id="entry-advance" name="advanceId"><option value="">Chọn khoản ứng trước</option>${advanceOptions().map(entry => `<option value="${esc(entry.id)}">${formatDate(entry.date)} · ${esc(entry.note || 'Ứng trước')} · còn ${money(entry.remaining)}</option>`).join('')}</select><small>Chỉ chọn khoản của người đang nhận hoàn. Đổi danh tính để hoàn cho người kia.</small></div><div class="field"><label for="entry-note">Ghi chú chung (không bắt buộc)</label><input id="entry-note" name="note" maxlength="200" placeholder="Ví dụ: Tiền đi chợ tuần này" autocomplete="off"></div><button class="button primary" type="submit">Ghi vào sổ chung</button></form>`}</section></div>`;
}
function renderPlans() {
  const info = summaryNow();
  const goal = state.goal;
  const progress = goal ? Math.min(100, Math.round(info.goalAvailable / goal.target * 100)) : 0;
  return introduction('Một kế hoạch để cùng nhìn về phía trước', 'Ngân sách lấy từ thỏa thuận đã duyệt. Hóa đơn chỉ giảm phần còn lại khi gắn với giao dịch thực tế.', `<span class="pill">Tháng ${monthLabel(month)}</span>`) + `<div class="metrics"><article class="metric"><span>Ngân sách đã thống nhất</span><strong>${info.plan ? money(info.budget) : 'Chưa có'}</strong><small>${info.plan ? `Áp dụng từ ${monthLabel(info.plan.month)}` : 'Cần hai người cùng đồng ý'}</small></article><article class="metric"><span>Đã chi trong tháng</span><strong>${money(info.spent)}</strong><small>Gồm cả phần ứng tiền riêng</small></article><article class="metric"><span>${info.plan && info.remaining < 0 ? 'Vượt ngân sách' : 'Ngân sách còn lại'}</span><strong class="${info.plan && info.remaining < 0 ? 'negative' : ''}">${info.plan ? money(Math.abs(info.remaining)) : '—'}</strong><small>${info.plan ? 'Chưa trừ hóa đơn chưa thanh toán' : 'Chưa thể tính khi chưa có thỏa thuận'}</small></article></div><div class="grid equal"><div class="stack"><section class="card"><div class="card-header"><div><h3>Hóa đơn tháng này</h3><p>Lịch nhắc trong demo, không thanh toán hoặc gửi thông báo.</p></div></div>${info.bills.length ? `<ul class="list">${info.bills.map(bill => `<li><div class="row"><div><strong>${esc(bill.title)}</strong><p>Hạn ${formatDate(bill.due)} · Tổng ${money(bill.amount)}</p></div><span class="amount">${bill.remaining ? money(bill.remaining) : 'Đã ghi đủ'}</span></div><p class="quiet">Đã ghi thanh toán: ${money(bill.paid)}${bill.remaining ? ` · Còn ${money(bill.remaining)}` : ''}</p>${bill.remaining && !closedThrough(month) ? `<button class="button small soft" type="button" data-pay-bill="${esc(bill.id)}">Ghi thanh toán</button>` : ''}</li>`).join('')}</ul>` : empty('Chưa có hóa đơn trong tháng', 'Thêm khoản cần nhớ như điện, nước, internet hoặc tiền nhà.')}</section><section class="card"><h3>Thêm hóa đơn</h3><form class="form" data-form="bill">${errorSlot}<div class="field"><label for="bill-title">Tên hóa đơn</label><input id="bill-title" name="title" required maxlength="100" placeholder="Ví dụ: Internet" autocomplete="off"></div><div class="fields">${moneyInput('bill-amount', 'Số tiền dự kiến (VND)')}<div class="field"><label for="bill-due">Ngày đến hạn</label><input id="bill-due" name="due" type="date" value="${month}-25" required></div></div><button class="button primary" type="submit">Thêm vào kế hoạch</button></form></section></div>
    <div class="stack"><section class="card"><div class="card-header"><div><h3>${goal ? esc(goal.title) : 'Mục tiêu chung'}</h3><p>${goal ? 'Phần quỹ còn lại sau khi dự phòng hoàn ứng.' : 'Chọn một điều hai người muốn cùng dành tiền.'}</p></div>${goal ? `<span class="pill">${progress}%</span>` : ''}</div>${goal ? `<div class="rule-detail"><div><span>Có thể dành trong quỹ</span><strong>${money(info.goalAvailable)}</strong></div><div><span>Mức mục tiêu</span><strong>${money(goal.target)}</strong></div></div><progress class="progress" value="${Math.min(info.goalAvailable, goal.target)}" max="${goal.target}" aria-label="Tiến độ mục tiêu chung">${progress}%</progress><p class="quiet">${money(Math.max(0, goal.target - info.goalAvailable))} còn cần thêm</p>${note('Đây là gợi ý dành tiền, không tạo ví riêng hay khóa số dư. Chưa trừ các hóa đơn chưa trả; số tiền khả dụng có thể giảm khi ghi chi.')}` : empty('Một dự định, cùng nhau', 'Nhập tên và mức tiền mục tiêu ở bên dưới. Không có mục tiêu hoặc số tiền mặc định.')}</section><section class="card"><h3>${goal ? 'Cập nhật mục tiêu' : 'Đặt mục tiêu'}</h3><form class="form" data-form="goal">${errorSlot}<div class="field"><label for="goal-title">Tên mục tiêu</label><input id="goal-title" name="title" value="${esc(goal?.title || '')}" maxlength="100" placeholder="Ví dụ: Chuyến đi cuối năm" required autocomplete="off"></div>${moneyInput('goal-target', 'Mức tiền mục tiêu (VND)', goal ? `value="${goal.target}"` : '')}<button class="button primary" type="submit">${goal ? 'Lưu mục tiêu chung' : 'Tạo mục tiêu chung'}</button><small class="quiet">Cả hai có thể chỉnh mục tiêu demo. Thay đổi xuất hiện trong sổ chung, chưa có bước duyệt riêng.</small></form></section></div></div>`;
}
function renderClose() {
  const info = summaryNow();
  const closing = state.closes.find(item => item.month === month);
  const isClosed = closedThrough(month);
  const snapshot = closing?.snapshot || info;
  const previous = summary(state, (() => { const date = new Date(`${month}-01T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() - 1); return date.toISOString().slice(0, 7); })());
  const expected = snapshot.plan?.expected || null;
  return introduction('Cùng kiểm tra, rồi cùng chốt', 'Đề nghị chốt tạo một ảnh chụp số liệu. Chỉ khi cả hai đồng ý, kỳ mới được khóa; số dư và khoản chưa hoàn tiếp tục sang tháng sau.', `<span class="pill${isClosed ? ' closed' : closing ? ' pending' : ''}">${monthLabel(month)} · ${isClosed ? 'Đã khóa' : closing ? 'Chờ xác nhận' : 'Chưa chốt'}</span>`) + `<div class="grid two"><section class="card"><div class="card-header"><div><h3>Bản đối chiếu tháng ${monthLabel(month)}</h3><p>${closing ? 'Số liệu tại thời điểm đề nghị chốt.' : 'Số liệu hiện tại trong sổ chung.'}</p></div></div><ul class="list"><li class="row"><span>Số dư chuyển từ tháng trước</span><strong class="amount">${money(previous.cash)}</strong></li>${['A', 'B'].map((value, index) => `<li><div class="row"><strong>${person(value)} đã góp tháng này</strong><span class="amount">${money(snapshot.contributions[value])}</span></div><p>${expected ? `Dự kiến ${money(expected[index])} · ${snapshot.contributions[value] < expected[index] ? `Còn ${money(expected[index] - snapshot.contributions[value])} so với thỏa thuận` : `Đã đủ${snapshot.contributions[value] > expected[index] ? `, hơn ${money(snapshot.contributions[value] - expected[index])}` : ''}`}` : 'Chưa có phần góp dự kiến; không tự tính khoản nợ.'}</p></li>`).join('')}<li class="row"><span>Tổng chi chung trong tháng</span><strong class="amount">${money(snapshot.spent)}</strong></li><li class="row"><span>Quỹ còn chuyển tiếp</span><strong class="amount">${money(snapshot.cash)}</strong></li><li class="row"><span>Cần hoàn Người A</span><strong class="amount">${money(snapshot.advances.A)}</strong></li><li class="row"><span>Cần hoàn Người B</span><strong class="amount">${money(snapshot.advances.B)}</strong></li></ul>${note('Thiếu phần góp là chênh lệch so với thỏa thuận, không tự biến thành nợ giữa hai người. Hoàn ứng là dòng tiền ra khỏi quỹ, không cộng chi tiêu lần nữa.')}<details class="details"><summary>Cách chuyển số dư và khóa kỳ</summary><p>Số dư quỹ và ứng trước chưa hoàn được tính cộng dồn sang tháng sau. Bản chốt không tạo thêm giao dịch nên không nhân đôi số dư.</p><p>Chốt một kỳ khóa toàn bộ ngày giao dịch đến cuối kỳ đó, kể cả các tháng cũ chưa chốt riêng. Bản demo chưa hỗ trợ mở lại kỳ.</p></details></section>
    <div class="stack"><section class="card"><h3>${isClosed ? 'Kỳ này đã khóa' : closing ? 'Cần thêm một xác nhận' : 'Sẵn sàng kiểm tra cùng nhau?'}</h3>${isClosed ? `<p>Không thể thêm giao dịch hoặc hóa đơn vào kỳ đã khóa. Số liệu và tiền chưa hoàn vẫn được giữ để xem ở tháng sau.</p>${closing ? `<p class="quiet">${approvals(closing.approvals)}</p>` : '<p class="quiet">Kỳ này nằm trong phạm vi một tháng sau đã được chốt.</p>'}<button class="button primary" type="button" data-next-month="${nextMonth(month)}">Xem tháng ${monthLabel(nextMonth(month))}</button>` : month > CURRENT_MONTH ? note('Không thể chốt tháng tương lai so với ngày mô phỏng 15/10/2026.', true) : closing ? `<p class="quiet">${approvals(closing.approvals)}</p>${closing.approvals.includes(actor) ? note(`Bạn đã xác nhận. Chuyển sang ${person(actor === 'A' ? 'B' : 'A')} để đối chiếu và đồng ý. Thêm giao dịch hoặc hóa đơn sẽ hủy bản chốt đang chờ.`) : `<form class="form" data-form="approve-close" data-id="${esc(closing.id)}">${errorSlot}${consent('approve-close-consent', 'Tôi đã đối chiếu số liệu và đồng ý khóa tháng này cùng các tháng trước. Tôi hiểu bản demo không hỗ trợ mở lại kỳ.')}<button class="button primary" type="submit">Đồng ý chốt tháng</button></form>`}` : `<p>Hãy đối chiếu phần góp, chi chung và khoản ứng trước với người còn lại.</p><form class="form" data-form="close">${errorSlot}${consent('close-consent', 'Tôi đã kiểm tra bản đối chiếu và đồng ý đề nghị khóa kỳ. Người còn lại cần xác nhận trước khi kỳ được khóa.')}<button class="button primary" type="submit">Đề nghị chốt tháng</button></form>`}</section>
    <section class="card"><h3>Trước khi xác nhận</h3><ul class="step-list"><li><span>Đối chiếu các khoản thực tế đã góp vào quỹ.</span></li><li><span>Kiểm tra chi chung và gắn các khoản đã trả với hóa đơn.</span></li><li><span>Xác nhận ứng trước, hoàn ứng và các khoản còn chuyển tiếp.</span></li></ul><div class="actions">${goButton('ledger', 'Kiểm tra sổ chung')}${goButton('plans', 'Xem hóa đơn')}</div></section></div></div>`;
}

function updateEntryFields() {
  const kind = document.querySelector('#entry-kind')?.value;
  if (!kind) return;
  const isPayment = ['expense', 'advance'].includes(kind);
  const billField = document.querySelector('#bill-field');
  const advanceField = document.querySelector('#advance-field');
  billField.hidden = !isPayment;
  advanceField.hidden = kind !== 'reimbursement';
  document.querySelector('#entry-bill').disabled = !isPayment;
  document.querySelector('#entry-advance').disabled = kind !== 'reimbursement';
  document.querySelector('#entry-advance').required = kind === 'reimbursement';
  const hints = {
    contribution: `Ghi tiền ${person(actor)} thực tế đã đưa vào quỹ. Không phải thu nhập cá nhân.`,
    expense: 'Trừ quỹ chung và tính một lần vào chi tiêu. Quỹ phải đủ tiền ở ngày giao dịch.',
    advance: `${person(actor)} dùng tiền riêng trả khoản chung: tính chi tiêu và ghi cần hoàn, chưa làm giảm quỹ.`,
    reimbursement: `${person(actor)} là người nhận hoàn. Trừ quỹ và giảm khoản cần hoàn; không tính chi tiêu lần nữa.`,
  };
  document.querySelector('#entry-help').textContent = hints[kind];
}
function updateMode() {
  const mode = document.querySelector('#plan-mode').value;
  const ratio = mode === 'ratio';
  for (const value of ['a', 'b']) {
    document.querySelector(`#value-${value}-label`).textContent = `Phần Người ${value.toUpperCase()} (${ratio ? '%' : 'VND'})`;
    const input = document.querySelector(`#value-${value}`);
    input.value = '';
    input.max = ratio ? '100' : '1000000000000';
  }
  document.querySelector('#value-a-help').textContent = ratio ? 'Nhập tỷ lệ hai người tự chọn, không dựa trên lương.' : 'Nhập số tiền đã trao đổi, có thể bằng 0.';
  document.querySelector('#value-b-help').textContent = ratio ? 'Hai tỷ lệ phải cộng thành 100%.' : 'Hai phần phải bằng ngân sách chung.';
}
function navigate(target) {
  view = target;
  clearMessage();
  render();
  root.focus({ preventScroll: true });
}

document.querySelector('#actor-select').addEventListener('change', event => {
  actor = event.target.value;
  clearMessage();
  render();
  notify(`Đang thử vai ${person(actor)}. Đây không phải phiên đăng nhập riêng.`);
});
document.querySelector('#month-select').addEventListener('change', event => {
  const next = event.target.value;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(next) || next < '1900-01' || next > '9999-11') { event.target.value = month; return; }
  month = next;
  clearMessage();
  render();
});
document.addEventListener('change', event => {
  if (event.target.id === 'plan-mode') updateMode();
  if (event.target.id === 'entry-kind') updateEntryFields();
});
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.view || button.dataset.go) { navigate(button.dataset.view || button.dataset.go); return; }
  if (button.dataset.nextMonth) { month = button.dataset.nextMonth; navigate('close'); return; }
  if (button.dataset.payBill) {
    const billId = button.dataset.payBill;
    navigate('ledger');
    const kind = document.querySelector('#entry-kind');
    if (!kind) return;
    kind.value = 'expense';
    updateEntryFields();
    document.querySelector('#entry-bill').value = billId;
    const bill = state.bills.find(item => item.id === billId);
    const paid = state.entries.filter(item => item.billId === billId).reduce((sum, item) => sum + item.amount, 0);
    document.querySelector('#entry-amount').value = bill.amount - paid;
    document.querySelector('#entry-note').value = bill.title;
    document.querySelector('#entry-amount').focus();
    return;
  }
  if (button.dataset.action === 'revoke') {
    try { mutate({ type: 'revokeInvite' }); render(); notify('Đã thu hồi lời mời demo. Người còn lại chưa tham gia.'); }
    catch (error) { notify(error.message, true); }
  }
});
root.addEventListener('submit', event => {
  const form = event.target.closest('[data-form]');
  if (!form) return;
  event.preventDefault();
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const value = name => String(data.get(name) || '').trim();
  const number = name => Number(data.get(name));
  let message = '';
  try {
    switch (form.dataset.form) {
      case 'create':
        if (!data.has('create-consent')) throw new Error('Cần đồng ý tạo sổ chung.');
        state = createSpace({ name: value('name'), owner: actor });
        view = 'space';
        message = 'Đã tạo không gian demo. Tiếp theo, tạo lời mời cho người còn lại.';
        break;
      case 'invite':
        if (!data.has('invite-consent')) throw new Error('Cần đồng ý phạm vi mời.');
        mutate({ type: 'invite', invitee: actor === 'A' ? 'B' : 'A', token: `MOI-DEMO-${sequence + 1}`, expires: '2026-10-31' });
        message = 'Đã tạo lời mời mô phỏng. Chuyển danh tính để thử chấp nhận; không có lời mời thật nào được gửi.';
        break;
      case 'accept':
        mutate({ type: 'acceptInvite', token: value('token'), consent: data.has('join-consent') });
        view = 'space';
        message = 'Cả hai đã đồng ý tham gia. Có thể đề xuất thỏa thuận và bắt đầu ghi sổ chung.';
        break;
      case 'plan':
        if (!data.has('plan-consent')) throw new Error('Cần đồng ý đề xuất.');
        mutate({ type: 'proposePlan', id: id('plan'), month: value('month'), mode: value('mode'), budget: number('budget'), values: [number('valueA'), number('valueB')] });
        message = 'Đã ghi đề xuất và xác nhận của bạn. Người còn lại cần đồng ý để thỏa thuận có hiệu lực.';
        break;
      case 'approve-plan':
        if (!data.has('approve-' + form.dataset.id)) throw new Error('Cần đồng ý thỏa thuận.');
        mutate({ type: 'approvePlan', id: form.dataset.id });
        message = 'Hai người đã đồng ý. Thỏa thuận có hiệu lực từ tháng đã chọn.';
        break;
      case 'entry': {
        const kind = value('kind');
        mutate({ type: 'addEntry', id: id('entry'), kind, amount: number('entry-amount'), date: value('date'), note: value('note'), ...(['expense', 'advance'].includes(kind) && value('billId') ? { billId: value('billId') } : {}), ...(kind === 'reimbursement' ? { advanceId: value('advanceId') } : {}) });
        month = value('date').slice(0, 7);
        message = 'Đã ghi giao dịch chung. Nếu có bản chốt đang chờ, hai người cần đối chiếu và xác nhận lại.';
        break;
      }
      case 'bill':
        mutate({ type: 'addBill', id: id('bill'), title: value('title'), amount: number('bill-amount'), due: value('due') });
        month = value('due').slice(0, 7);
        message = 'Đã thêm hóa đơn dự kiến. Gắn giao dịch với hóa đơn khi khoản tiền thực tế được trả.';
        break;
      case 'goal':
        mutate({ type: 'setGoal', title: value('title'), target: number('goal-target') });
        message = 'Đã cập nhật mục tiêu chung trong bản demo.';
        break;
      case 'close':
        if (!data.has('close-consent')) throw new Error('Cần đồng ý đề nghị chốt.');
        mutate({ type: 'proposeClose', id: id('close'), month });
        message = 'Đã đề nghị chốt. Người còn lại cần kiểm tra số liệu và đồng ý.';
        break;
      case 'approve-close':
        if (!data.has('approve-close-consent')) throw new Error('Cần đồng ý khóa kỳ.');
        mutate({ type: 'approveClose', id: form.dataset.id });
        message = 'Hai người đã đồng ý chốt kỳ. Số dư và khoản cần hoàn tiếp tục sang tháng sau.';
        break;
      default: return;
    }
    render();
    notify(message);
  } catch (error) {
    const slot = form.querySelector('.form-error');
    slot.textContent = error instanceof Error ? error.message : 'Chưa thể lưu. Kiểm tra lại thông tin.';
    slot.hidden = false;
    slot.setAttribute('tabindex', '-1');
    slot.focus({ preventScroll: false });
  }
});
render();
