// Hướng dẫn: the in-app manual. Index explains the design (three ideas, five tabs), topic pages
// go deep, and Home shows a "Làm quen" checklist until a new user has tried each part once.
// Guide prose is Vietnamese-only content kept here rather than in i18n.js.

export const GUIDE_TOPICS = Object.freeze([
  {id:'start',icon:'cash',title:'Bắt đầu và số dư ban đầu',summary:'Tạo sổ, nhập số tiền đang có, thêm tài khoản khác.',tryRoute:'accounts/new',tryLabel:'Thêm tài khoản',sections:[
    {h:'Sổ bắt đầu từ hôm nay',p:['Bạn không cần nhập lại giao dịch cũ. Chỉ cần cho biết mỗi tài khoản hiện có bao nhiêu tiền; đó là “Số dư ban đầu”.','Số dư ban đầu không tính là thu nhập, nên báo cáo tháng đầu không bị phồng lên.']},
    {h:'Thêm các nơi giữ tiền khác',steps:['Vào Thêm › Tài khoản › Thêm tài khoản.','Chọn loại: Ngân hàng, Tiền mặt, Ví điện tử hoặc Đầu tư.','Nhập tên dễ nhận ra (ví dụ “VCB lương”, “Ví MoMo”) và số dư hôm nay.'],tip:'Ngân hàng, tiền mặt và ví điện tử cộng vào “Tiền có thể dùng”. Tài khoản Đầu tư chỉ cộng vào Tổng tài sản.'},
    {h:'Muốn thử trước?',p:['Ở cuối mục Thêm có “Thử trong kho riêng”: một sổ tách biệt để bấm thử thoải mái. Dữ liệu thật không bị ảnh hưởng; bấm “Về dữ liệu thật” để quay lại.']}
  ]},
  {id:'record',icon:'add',title:'Ghi thu, chi và chuyển tiền',summary:'Nút ＋ ở giữa thanh dưới, bàn phím số, danh mục; sửa và huỷ an toàn.',tryRoute:'transactions/new/expense',tryLabel:'Ghi giao dịch',sections:[
    {h:'Ghi một khoản trong vài giây',steps:['Bấm nút ＋ tròn ở giữa thanh dưới.','Chọn Chi, Thu hoặc Chuyển.','Gõ số tiền bằng bàn phím số; phím 000 thêm ba số 0.','Chọn danh mục (hoặc “＋ Danh mục mới”), tài khoản và ngày, rồi bấm Lưu.']},
    {h:'Chuyển không phải thu hay chi',p:['Rút tiền ATM hay nạp ví là chuyển giữa hai tài khoản của bạn. Chọn “Chuyển” để tổng tiền giữ nguyên và báo cáo thu chi không bị sai.'],tip:'Phí chuyển khoản là một khoản Chi riêng.'},
    {h:'Ghi nhầm thì sửa hoặc huỷ',p:['Mở giao dịch trong Sổ, chọn “Sửa giao dịch” để đổi số tiền, ngày, ghi chú hay tài khoản; hoặc “Huỷ giao dịch” nếu khoản đó không có thật.','CashWeave không xoá dữ liệu: bản gốc được giữ trong lịch sử, giao dịch mới hiện nhãn “Đã sửa”. Trong Sổ, bật “Hiện cả bản gốc đã sửa/huỷ” để xem lại.']},
    {h:'Tìm lại giao dịch',p:['Tab Sổ liệt kê theo tháng, có ô tìm kiếm và bộ lọc Chi / Thu / Chuyển. Danh sách tải dần 50 dòng một lần.']}
  ]},
  {id:'plans',icon:'calendar',title:'Kế hoạch: khoản sắp thu, sắp trả',summary:'Nhắc tiền nhà, điện nước, lương; bấm “Đã trả” khi xong.',tryRoute:'plans/new',tryLabel:'Thêm khoản sắp thu / sắp trả',sections:[
    {h:'Khoản dự kiến chưa phải tiền thật',p:['Một khoản trong Kế hoạch chỉ là lời nhắc: số dư tài khoản chưa đổi cho tới khi bạn bấm “Đã trả” hoặc “Đã nhận”.']},
    {h:'Thêm một khoản',steps:['Vào Kế hoạch › Sắp đến hạn › Thêm khoản sắp thu / sắp trả.','Nhập tên, số tiền, ngày đến hạn và tài khoản dự kiến.','Chọn “Hằng tháng” cho khoản lặp lại như tiền nhà, lương, internet.']},
    {h:'Khi đến hạn',p:['Trang chủ hiện các khoản trong 30 ngày tới, khoản quá hạn hiện màu cảnh báo.'],steps:['Bấm “Đã trả” (hoặc “Đã nhận”): app mở sẵn màn hình ghi giao dịch với số tiền và tài khoản đã điền.','Trả thiếu? Ghi số thật đã trả; khoản đó hiện “Đã trả một phần” và nút “Trả tiếp”.','Không phải trả nữa? Mở khoản đó và chọn “Đã xong”, “Bỏ qua tháng này” hoặc “Dời ngày”.']},
    {h:'Nhìn trước cuối tháng',p:['Thêm › Dự báo dòng tiền cho biết nếu trả đủ các khoản đang chờ thì đến một ngày bạn còn khoảng bao nhiêu.']}
  ]},
  {id:'jars',icon:'split',title:'Hũ: đặt mục đích cho tiền',summary:'Chia tiền vào hũ không chuyển tiền đi đâu; “Chưa có mục đích” là phần còn tự do.',tryRoute:'funds',tryLabel:'Mở Hũ',sections:[
    {h:'Hũ là nhãn mục đích, không phải tài khoản',p:['Khi chia 2.000.000 ₫ vào hũ “Thiết yếu”, tiền vẫn nằm nguyên trong tài khoản ngân hàng. Hũ chỉ ghi nhớ rằng số tiền đó đã có việc để làm.','Vì vậy luôn có: Tiền có thể dùng = Tiền đã chia vào hũ + Chưa có mục đích.']},
    {h:'Chia tiền vào hũ',steps:['Chọn một phương pháp chia (xem chủ đề Phương pháp chia tiền).','Ở Trang chủ bấm dòng “… chưa có mục đích. Chia vào hũ?”, hoặc mở một khoản thu và chọn “Chia khoản thu này vào hũ”.','Chọn Toàn bộ, Một nửa hoặc nhập số tiền, bấm “Xem trước” để thấy mỗi hũ nhận bao nhiêu, rồi “Xác nhận chia”.']},
    {h:'Tiêu từ một hũ',p:['Mở khoản chi trong Sổ, chọn “Trừ vào hũ” và chọn hũ. Số dư hũ giảm, tổng tiền không bị trừ hai lần. Đổi ý thì chọn “Bỏ trừ vào hũ”.']},
    {h:'Chia nhầm?',p:['Mở lần chia trong Hũ › Các lần đã chia và chọn “Hoàn tác lần chia”. Nếu bạn chia nhiều hơn số đang có, app hiện cảnh báo và gợi ý cách sửa thay vì cho “Chưa có mục đích” âm.'],tip:'Hũ hữu ích nhất khi bạn chia ngay lúc nhận lương hoặc một khoản thu lớn.'}
  ]},
  {id:'methods',icon:'recipe',title:'Phương pháp chia tiền',summary:'6 chiếc hũ, 50/30/20, Trả cho mình trước, Ngân sách bằng 0, hoặc tự tạo.',tryRoute:'recipes',tryLabel:'Xem các phương pháp',sections:[
    {h:'Bốn cách phổ biến',p:['Ví dụ khi nhận 10.000.000 ₫:'],steps:['6 chiếc hũ: Thiết yếu 55% (5,5 triệu), Tự do tài chính 10%, Tiết kiệm dài hạn 10%, Học tập 10%, Hưởng thụ 10%, Cho đi 5%.','50/30/20: Thiết yếu 50%, Mong muốn 30%, Tiết kiệm & trả nợ 20%.','Trả cho mình trước: để riêng 20% cho tiết kiệm và đầu tư; 80% còn lại chi tiêu linh hoạt.','Ngân sách bằng 0: giao từng khoản cố định cho từng việc theo thứ tự ưu tiên; phần dư vào hũ Dự phòng.']},
    {h:'Chọn và chỉnh',steps:['Vào Kế hoạch › Hũ › Phương pháp chia › Đổi.','Bấm một phương pháp để xem các hũ, rồi “Dùng và chỉnh”.','Tăng giảm từng tỷ lệ, đổi tên hũ, thêm hoặc bỏ hũ; thanh màu cho biết đã dùng bao nhiêu phần trăm. Bấm “Lưu phương pháp”.']},
    {h:'Phần trăm hay số cố định',p:['“% phần còn lại” chia theo tỷ lệ. “Số cố định” giữ một khoản tiền cho việc cụ thể, ví dụ tiền nhà 5.000.000 ₫, được chia trước theo thứ tự ưu tiên; phần trăm tính trên phần còn lại.'],tip:'Các phương pháp là gợi ý tham khảo phổ biến, không phải lời khuyên tài chính cá nhân.'}
  ]},
  {id:'assets',icon:'assets',title:'Tổng tài sản và đầu tư',summary:'Theo dõi chứng khoán, chứng chỉ quỹ, vàng, crypto mà không lẫn vào tiền tiêu.',tryRoute:'assets',tryLabel:'Mở Tổng tài sản',sections:[
    {h:'Hai con số khác nhau',p:['“Tiền có thể dùng” là tiền bạn chi được ngay. “Tổng tài sản” cộng thêm giá trị các tài khoản Đầu tư. Giá lên xuống chỉ đổi Tổng tài sản, không tính là thu hay chi.']},
    {h:'Theo dõi một khoản đầu tư',steps:['Thêm tài khoản loại Đầu tư (Thêm › Tài khoản).','Chuyển tiền từ ngân hàng sang tài khoản đầu tư bằng “Chuyển” khi bạn mua.','Thỉnh thoảng vào Tổng tài sản › Cập nhật giá: nhập số lượng và giá từng mã, hoặc chỉ nhập tổng giá trị.'],tip:'Số lượng nhập kiểu Việt Nam: “1.000” là một nghìn, “0,5” là nửa. App hiện “Hiểu là …” ngay khi bạn gõ.'},
    {h:'Giá cũ',p:['Giá do bạn tự cập nhật, app không lấy giá từ Internet. Khi giá đã cũ hơn 7 ngày, app nhắc bạn cập nhật lại.']}
  ]},
  {id:'reports',icon:'report',title:'Báo cáo tháng',summary:'Thu, chi, để dành được bao nhiêu và tiền đi đâu theo danh mục.',tryRoute:'reports',tryLabel:'Mở Báo cáo',sections:[
    {h:'Xem nhanh',p:['Trang chủ hiện Thu và Chi tháng này; bấm vào từng ô để xem các giao dịch tạo nên con số đó.']},
    {h:'Báo cáo đầy đủ',steps:['Vào Thêm › Báo cáo và chọn tháng.','Xem thu, chi, số để dành được và so sánh với tháng trước.','Bấm một danh mục để xem từng giao dịch trong đó.'],tip:'Số dư ban đầu và chuyển giữa các tài khoản không tính vào thu chi.'}
  ]},
  {id:'backup',icon:'data',title:'Sao lưu, khôi phục và riêng tư',summary:'Dữ liệu chỉ nằm trên máy này; hãy giữ một tệp sao lưu.',tryRoute:'data',tryLabel:'Mở Sao lưu & khôi phục',sections:[
    {h:'Dữ liệu ở đâu',p:['CashWeave chạy không cần mạng, không đăng nhập và không gửi dữ liệu đi đâu. Đổi lại, nếu mất máy hoặc gỡ ứng dụng mà chưa sao lưu, sổ sẽ mất.']},
    {h:'Sao lưu',steps:['Vào Thêm › Sao lưu & khôi phục › Sao lưu ngay.','Chọn nơi lưu tệp JSON: bộ nhớ máy, thẻ nhớ hoặc thư mục bạn đồng bộ.','Làm lại mỗi tuần; Trang chủ nhắc khi bản sao lưu đã cũ hơn 7 ngày.'],tip:'Tệp sao lưu không được mã hoá. Đừng gửi tệp này qua kênh công khai.'},
    {h:'Khôi phục',p:['Chọn “Kiểm tra bản sao để khôi phục”, chọn tệp, xem trước nội dung rồi mới xác nhận. Sổ hiện tại vẫn được giữ lại để quay về nếu cần.']},
    {h:'Che số tiền',p:['Bấm biểu tượng con mắt ở Trang chủ để ẩn mọi số tiền khi đưa máy cho người khác xem. Khoá bằng vân tay / mã PIN đang được phát triển (“Sắp có”).']}
  ]}
]);

const TABS = [
  ['home','Trang chủ','Bạn có bao nhiêu, khoản nào sắp phải trả, tiền nào chưa có mục đích.'],
  ['ledger','Sổ','Mọi giao dịch theo tháng; tìm, lọc, sửa hoặc huỷ.'],
  ['add','＋','Ghi nhanh một khoản Chi, Thu hoặc Chuyển.'],
  ['calendar','Kế hoạch','Khoản sắp thu, sắp trả và các hũ.'],
  ['more','Thêm','Tổng tài sản, tài khoản, báo cáo, danh mục, sao lưu và hướng dẫn này.']
];
const IDEAS = [
  ['cash','tone-green','Tài khoản giữ tiền thật','Số dư mỗi tài khoản phải khớp với ngân hàng, ví hay tiền mặt của bạn.'],
  ['split','tone-blue','Hũ đặt mục đích cho tiền','Chia vào hũ không chuyển tiền đi đâu, chỉ ghi nhớ số tiền đó dành cho việc gì.'],
  ['calendar','tone-amber','Kế hoạch nhắc tiền sắp đến','Khoản sắp thu, sắp trả chưa phải tiền thật cho tới khi bạn bấm “Đã trả” hoặc “Đã nhận”.']
];
const QUICK_STEPS = [
  ['Tạo sổ với số dư hôm nay','Chọn ngân hàng hoặc tiền mặt và nhập số tiền đang có. Sổ bắt đầu trắng, không có giao dịch mẫu.'],
  ['Ghi tiền vào, tiền ra','Bấm ＋ để ghi Chi, Thu hoặc Chuyển. Mất chưa tới 10 giây mỗi khoản.'],
  ['Thêm khoản sắp phải trả','Tiền nhà, điện nước, học phí… hiện ở Trang chủ trước hạn để bạn không quên.'],
  ['Chia tiền vào hũ và sao lưu','Chọn một phương pháp chia khi nhận lương, rồi xuất một tệp sao lưu mỗi tuần.']
];
const FAQ = [
  ['Vì sao số dư ban đầu không tính là thu nhập?','Đó là tiền bạn đã có trước khi dùng app. Nếu tính là thu, báo cáo tháng đầu sẽ sai.'],
  ['Chia vào hũ có làm giảm số dư tài khoản không?','Không. Hũ chỉ là nhãn mục đích. Số dư chỉ đổi khi bạn ghi một khoản Chi, Thu hoặc Chuyển.'],
  ['Tôi lỡ ghi nhầm số tiền thì sao?','Mở giao dịch và chọn “Sửa giao dịch”. Bản gốc vẫn nằm trong lịch sử, tổng tiền được tính theo bản đã sửa.'],
  ['Rút tiền ATM thì ghi thế nào?','Chọn “Chuyển” từ tài khoản ngân hàng sang tiền mặt. Đó không phải thu hay chi.'],
  ['Đổi điện thoại có mất dữ liệu không?','Có, nếu chưa sao lưu. Xuất tệp sao lưu trên máy cũ rồi chọn “Tôi đã có bản sao lưu” trên máy mới.'],
  ['App có cần Internet hay tài khoản không?','Không. Mọi thứ nằm trên máy này; app không gửi dữ liệu đi đâu.'],
  ['Giá cổ phiếu, vàng có tự cập nhật không?','Không. Bạn tự nhập giá trong Tổng tài sản › Cập nhật giá, vì app chạy hoàn toàn ngoại tuyến.']
];
const GLOSSARY = [
  ['Tiền có thể dùng','Tổng số dư các tài khoản ngân hàng, tiền mặt và ví điện tử.'],
  ['Tổng tài sản','Tiền có thể dùng cộng giá trị các tài khoản Đầu tư.'],
  ['Chưa có mục đích','Phần tiền có thể dùng chưa được chia vào hũ nào.'],
  ['Hũ','Nhãn mục đích cho một phần tiền: Thiết yếu, Tiết kiệm, Du lịch…'],
  ['Phương pháp chia','Công thức chia một khoản tiền vào các hũ theo tỷ lệ hoặc số cố định.'],
  ['Khoản sắp thu / sắp trả','Lời nhắc tiền dự kiến; chưa đổi số dư cho tới khi ghi “Đã trả” / “Đã nhận”.'],
  ['Chuyển','Tiền đi giữa hai tài khoản của bạn; không tính là thu hay chi.'],
  ['Đã sửa / Đã huỷ','Nhãn của giao dịch đã chỉnh hoặc huỷ; bản gốc vẫn được giữ trong lịch sử.']
];

export const topicById = id => GUIDE_TOPICS.find(topic => topic.id === id) || null;

// Small "?" chip placed next to a screen title, opening the matching topic page.
export function helpLink(c,topicId){
  const {h,t,icon,run,go}=c;
  return h('a',{href:'#help/'+topicId,class:'help-chip','data-help':topicId,'aria-label':t('helpAbout')+': '+topicById(topicId).title,onClick:run(()=>go('help/'+topicId))},icon('help'),h('span',{},t('helpChip')));
}

function gettingStartedSteps(c){
  const state=c.state,prefs=c.prefs();
  return [
    {id:'guide',label:'gsGuide',route:'help',done:!!prefs.guideSeenAtUtc},
    {id:'record',label:'gsRecord',route:'transactions/new/expense',done:state.operations.some(o=>['INCOME','EXPENSE','TRANSFER'].includes(o.operationType))},
    {id:'plan',label:'gsPlan',route:'plans/new',done:state.occurrences.length>0||state.planSeries.length>0},
    {id:'method',label:'gsMethod',route:'recipes',done:state.templates.length>0},
    {id:'backup',label:'gsBackup',route:'',done:c.backupStatus().days!==null}
  ];
}

// Home card for new users. Disappears once every step is done or the user hides it.
export function gettingStartedCard(c){
  const {h,t,fill,icon,run,go,action}=c;
  if(c.prefs().gettingStartedHidden)return null;
  const steps=gettingStartedSteps(c),done=steps.filter(step=>step.done).length;
  if(done===steps.length)return null;
  const open=step=>run(async()=>{if(step.route)await go(step.route);else await c.exportBackup();});
  return h('section',{class:'card getting-started','data-getting-started':'true'},
    h('div',{class:'section-heading'},h('h2',{},t('gsTitle')),h('span',{class:'tag'},fill(t('gsProgress'),{done,total:steps.length}))),
    h('div',{class:'gs-bar',role:'progressbar','aria-valuemin':'0','aria-valuemax':String(steps.length),'aria-valuenow':String(done),'aria-label':t('gsTitle')},h('span',{style:'width:'+Math.round(done*100/steps.length)+'%'})),
    h('ul',{class:'gs-list'},steps.map(step=>h('li',{class:step.done?'done':''},
      h('button',{type:'button',class:'gs-step','data-gs-step':step.id,disabled:step.done,onClick:open(step)},h('span',{class:'gs-check','aria-hidden':'true'},step.done?'✓':''),h('span',{class:'grow'},t(step.label)),step.done?h('span',{class:'sr-only'},t('gsDone')):icon('chevron'))))),
    action('gsHide',()=>{c.setPrefs({gettingStartedHidden:true});return c.render();},false,{class:'button text-button','data-gs-hide':'true'}));
}

export function helpScreen(c,topicId=''){
  if(!c.prefs().guideSeenAtUtc)c.setPrefs({guideSeenAtUtc:c.clock().toISOString()});
  const topic=topicById(topicId);
  return topic?topicScreen(c,topic):guideIndex(c);
}

function guideIndex(c){
  const {h,t,icon,run,go,action,link,hasBook}=c;
  const book=hasBook();
  return [
    h('div',{class:'page-head'},h('h1',{},t('help')),h('p',{class:'muted'},t('guideLead'))),
    h('section',{class:'card guide-model','data-guide':'ideas'},h('h2',{},t('guideIdeas')),
      h('ul',{class:'benefits'},IDEAS.map(([iconName,tone,heading,body])=>h('li',{class:'benefit'},h('span',{class:'benefit-icon '+tone},icon(iconName)),h('div',{},h('strong',{},heading),h('p',{},body))))),
      h('div',{class:'guide-equation','aria-label':t('guideEquationLabel')},h('span',{class:'eq-term'},t('spendable')),h('span',{class:'eq-op'},'='),h('span',{class:'eq-term blue'},t('moneyAssigned')),h('span',{class:'eq-op'},'+'),h('span',{class:'eq-term amber'},t('unassigned')))),
    h('section',{class:'card','data-guide':'tabs'},h('h2',{},t('guideTabs')),
      h('ul',{class:'guide-tabs'},TABS.map(([iconName,name,body])=>h('li',{},h('span',{class:'guide-tab-icon'+(iconName==='add'?' fab':'')},icon(iconName)),h('div',{},h('strong',{},name),h('p',{},body)))))),
    h('section',{class:'card','data-guide':'quick'},h('h2',{},t('guideQuick')),
      h('ol',{class:'guide-steps'},QUICK_STEPS.map(([heading,body],index)=>h('li',{},h('span',{class:'step-number','aria-hidden':'true'},String(index+1)),h('div',{},h('strong',{},heading),h('p',{},body))))),
      h('div',{class:'actions'},book?action('gsRecord',()=>go('transactions/new/expense'),true):action('beginCreate',()=>go('create'),true))),
    h('h2',{class:'group-title'},t('guideTopics')),
    h('section',{class:'card list-card','data-guide':'topics'},GUIDE_TOPICS.map(topic=>h('a',{href:'#help/'+topic.id,class:'menu-row','data-topic':topic.id,onClick:run(()=>go('help/'+topic.id))},h('span',{class:'topic-icon'},icon(topic.icon)),h('span',{class:'grow'},h('span',{class:'row-title'},topic.title),h('span',{class:'row-meta'},topic.summary)),icon('chevron')))),
    h('h2',{class:'group-title'},t('guideFaq')),
    h('section',{class:'card list-card','data-guide':'faq'},FAQ.map(([q,a])=>h('details',{class:'faq'},h('summary',{},q),h('p',{},a)))),
    h('h2',{class:'group-title'},t('guideGlossary')),
    h('section',{class:'card','data-guide':'glossary'},h('dl',{class:'glossary'},GLOSSARY.flatMap(([term,meaning])=>[h('dt',{},term),h('dd',{},meaning)]))),
    h('div',{class:'actions'},book?link('overview',t('navHome'),{class:'button'}):action('returnStart',()=>go('start')))
  ];
}

function topicScreen(c,topic){
  const {h,t,icon,run,go,action,hasBook}=c,book=hasBook(),index=GUIDE_TOPICS.indexOf(topic),next=GUIDE_TOPICS[index+1];
  return [
    h('div',{class:'page-head topic-head'},h('span',{class:'topic-icon large'},icon(topic.icon)),h('p',{class:'muted'},t('help')+' · '+(index+1)+'/'+GUIDE_TOPICS.length),h('h1',{},topic.title),h('p',{class:'muted'},topic.summary)),
    ...topic.sections.map(section=>h('section',{class:'card guide-section'},h('h2',{},section.h),
      ...(section.p||[]).map(text=>h('p',{},text)),
      section.steps?h('ol',{class:'guide-substeps'},section.steps.map(text=>h('li',{},text))):null,
      section.tip?h('p',{class:'guide-tip'},icon('help'),h('span',{},section.tip)):null)),
    h('div',{class:'actions'},book?action(topic.tryLabel,()=>go(topic.tryRoute),true,{'data-try':topic.tryRoute}):action('beginCreate',()=>go('create'),true),
      next?h('a',{href:'#help/'+next.id,class:'button','data-next-topic':next.id,onClick:run(()=>go('help/'+next.id))},t('guideNext')+': '+next.title):null,
      h('a',{href:'#help',class:'button text-button',onClick:run(()=>go('help'))},t('guideAll')))
  ];
}
