import { Capacitor, registerPlugin } from './capacitor-runtime.js';
import { handleLegacyBack } from '../app.js';
import { configureLegacyServices } from '../legacy-platform.js';
import { createNativeBackupAdapter } from './backup-bridge.js';
import { createNativeBackHandler } from './back-handler.js';

const feedback = document.getElementById('native-feedback');
function showStatus(text, error = false) {
  feedback.replaceChildren();
  feedback.dataset.error = String(error);
  feedback.setAttribute('role', error ? 'alert' : 'status');
  const message = document.createElement('span'); message.textContent = text;
  const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.textContent = 'Đóng';
  dismiss.addEventListener('click', () => feedback.replaceChildren());
  feedback.append(message, dismiss);
}
const plugin = registerPlugin('LocalBackup');
if (!['android', 'ios'].includes(Capacitor.getPlatform()) || !Capacitor.isPluginAvailable('LocalBackup')) {
  document.querySelector('.app-shell').hidden = true;
  showStatus('Chưa mở được cầu nối lưu tệp. Hãy mở lại ứng dụng, giữ nguyên dữ liệu và không cài lại.', true);
} else {
  const adapter = createNativeBackupAdapter(plugin, showStatus, () => feedback.replaceChildren());
  configureLegacyServices({ ...adapter, native: true });
  window.addEventListener('cashweaveNativeBack', createNativeBackHandler({
    acknowledgeBack: value => plugin.acknowledgeBack(value),
    minimize: async () => window.location.assign('./index.html')
  }, () => ({ handleNativeBack: handleLegacyBack }), showStatus));
  const showInterruption = () => showStatus('Thao tác tệp đã bị gián đoạn. Tệp có thể trống, chưa đầy đủ hoặc đã được ghi; hãy kiểm tra trước khi dùng. Dữ liệu trong ứng dụng không đổi.', true);
  plugin.addListener('backupInterrupted', showInterruption).then(() => plugin.consumeInterruption()).then(result => {
    if (result.interrupted) showInterruption();
  }).catch(() => showStatus('Chưa kiểm tra được thao tác tệp trước đó. Hãy kiểm tra tệp trước khi dùng.', true));
  plugin.ready().catch(() => showStatus('Chưa bật được điều hướng native. Hãy dùng nút quay lại trong ứng dụng.', true));
}
