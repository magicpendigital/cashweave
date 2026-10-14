import { Capacitor, registerPlugin } from './capacitor-runtime.js';
import { createNextApp } from '../ui/app.js';
import { showStorageFailure } from '../ui/storage-failure.js';
import { createNativeBackupAdapter } from './backup-bridge.js';
import { createNativeBackHandler } from './back-handler.js';

const root = document.getElementById('next-app');
const nativeFeedback = document.getElementById('native-feedback');
function showStatus(text, error = false) {
  nativeFeedback.replaceChildren();
  nativeFeedback.dataset.error = String(error);
  nativeFeedback.setAttribute('role', error ? 'alert' : 'status');
  const message = document.createElement('span');
  message.textContent = text;
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.textContent = 'Đóng';
  dismiss.addEventListener('click', () => nativeFeedback.replaceChildren());
  nativeFeedback.append(message, dismiss);
}

const LocalBackup = registerPlugin('LocalBackup');
let app = null;
window.addEventListener('cashweaveNativeBack', createNativeBackHandler(LocalBackup, () => app, showStatus));

if (Capacitor.getPlatform() !== 'android' || !Capacitor.isPluginAvailable('LocalBackup')) {
  root.replaceChildren();
  showStatus('Bản Android chưa mở được cầu nối lưu tệp. Hãy giữ nguyên dữ liệu và dùng bản HTML để thử riêng với dữ liệu giả.', true);
} else {
  const backup = createNativeBackupAdapter(LocalBackup, showStatus);
  const showInterruption = () => showStatus('Thao tác tệp đã bị gián đoạn. Tệp có thể trống, chưa đầy đủ hoặc đã được ghi; hãy kiểm tra trước khi dùng. Dữ liệu trong ứng dụng không đổi.', true);
  LocalBackup.addListener('backupInterrupted', showInterruption).then(() => LocalBackup.consumeInterruption()).then(result => {
    if (result.interrupted) showInterruption();
  }).catch(() => showStatus('Chưa kiểm tra được trạng thái thao tác tệp trước đó. Hãy kiểm tra bản sao trước khi dùng.', true));
  createNextApp(root, backup).then(async value => { app = value; await LocalBackup.ready(); }).catch(() => showStorageFailure(root));
}
