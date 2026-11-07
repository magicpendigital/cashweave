export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;

// Native completion is the only success signal. Never fall back to blob URLs,
// whose download behavior is unreliable in Android WebView.
export function createNativeBackupAdapter(plugin, showStatus, clearStatus = () => {}) {
  let pending = false;
  async function run(operation) {
    if (pending) { showStatus('Đang chọn hoặc lưu tệp. Hãy hoàn tất thao tác đang mở.', true); return null; }
    pending = true;
    try { clearStatus(); return await operation(); }
    finally { pending = false; }
  }
  return {
    onDownload: async (text, filename) => run(async () => {
      try {
        if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) throw new Error('BACKUP_TOO_LARGE');
        const expectedBytes = new TextEncoder().encode(text).byteLength;
        const csv = typeof filename === 'string' && filename.endsWith('.csv');
        const result = csv
          ? await plugin.saveText({ text, filename, mimeType: 'text/csv' })
          : await plugin.saveJson({ text, filename });
        if (result.cancelled) { showStatus('Đã hủy xuất bản sao. Chưa lưu tệp.'); return { status: 'cancelled' }; }
        if (result.saved !== true || result.bytes !== expectedBytes || result.bytes <= 0) throw new Error('BACKUP_WRITE_FAILED');
        showStatus(csv ? 'Đã lưu tệp CSV vào vị trí bạn chọn. Hãy giữ tệp riêng tư.' : 'Đã lưu bản sao JSON vào vị trí bạn chọn. Hãy giữ tệp riêng tư và thử khôi phục để kiểm tra.');
        return { status: 'written', bytes: expectedBytes };
      } catch (error) {
        showStatus(error?.message === 'BACKUP_TOO_LARGE' ? 'Bản sao vượt giới hạn 5 MiB. Chưa lưu tệp.' : 'Không xác nhận được bản sao JSON đã lưu đầy đủ. Tệp có thể trống hoặc chưa đầy đủ; hãy kiểm tra và xuất lại. Dữ liệu trong ứng dụng vẫn giữ nguyên.', true);
        return { status: 'failed' };
      }
    }),
    onReadBackup: async () => run(async () => {
      try {
        const result = await plugin.openJson();
        if (result.cancelled) { showStatus('Đã hủy chọn bản sao. Dữ liệu hiện tại không thay đổi.'); return null; }
        if (typeof result.text !== 'string' || !Number.isInteger(result.bytes) || result.bytes > MAX_BACKUP_BYTES || result.bytes < 1) throw new Error('BACKUP_READ_FAILED');
        if (new TextEncoder().encode(result.text).byteLength !== result.bytes) throw new Error('BACKUP_READ_FAILED');
        return { text: result.text, size: result.bytes };
      } catch (error) {
        showStatus(error?.message === 'BACKUP_TOO_LARGE' ? 'Tệp vượt giới hạn 5 MiB. Chưa khôi phục dữ liệu.' : 'Không đọc được tệp JSON. Dữ liệu hiện tại không thay đổi. Hãy chọn tệp trên thiết bị rồi thử lại.', true);
        return null;
      }
    })
  };
}
