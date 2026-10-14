export function createNativeBackHandler(plugin, getApp, showStatus) {
  let handling = false;
  return async event => {
    // Every event gets its own acknowledgement, including rapid repeated Back.
    // If the bridge cannot acknowledge, the native bounded fallback remains live.
    try { await plugin.acknowledgeBack({ requestId: event.requestId }); }
    catch { return; }
    if (handling) return;
    handling = true;
    try {
      const app = getApp();
      const consumed = app ? await app.handleNativeBack() : false;
      if (!consumed) await plugin.minimize();
    } catch {
      showStatus('Chưa thể quay lại. Hãy dùng nút Quay lại trong ứng dụng.', true);
    } finally { handling = false; }
  };
}
