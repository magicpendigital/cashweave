package app.cashweave.offline.trial;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/** Local-only SAF adapter. Financial payload stays transient, never in Android
 * instance state, logs, preferences, retained URI grants, or app-private files. */
@CapacitorPlugin(name = "LocalBackup")
public class LocalBackupPlugin extends Plugin {
    private static final int MAX_BYTES = 64 * 1024 * 1024;
    private static final long IO_TIMEOUT_SECONDS = 30;
    private static final String INTERRUPTION = "backupPending";
    private final ExecutorService ioExecutor = Executors.newSingleThreadExecutor(r -> daemon(r, "cashweave-backup-io"));
    private final ExecutorService cleanupExecutor = Executors.newSingleThreadExecutor(r -> daemon(r, "cashweave-backup-close"));
    private final ScheduledExecutorService timeoutExecutor = Executors.newSingleThreadScheduledExecutor(r -> daemon(r, "cashweave-backup-timeout"));
    private Operation active;
    private volatile boolean destroyed;
    private volatile boolean restoredInterruption;

    private static Thread daemon(Runnable runnable, String name) {
        Thread thread = new Thread(runnable, name);
        thread.setDaemon(true);
        return thread;
    }

    private static final class Operation {
        final PluginCall call;
        final CancellationSignal signal = new CancellationSignal();
        final AtomicBoolean settled = new AtomicBoolean(false);
        volatile byte[] payload;
        volatile Closeable stream;
        volatile Future<?> task;
        volatile Future<?> timeout;
        Operation(PluginCall call, byte[] payload) { this.call = call; this.payload = payload; }
    }

    private SharedPreferences markers() {
        return getContext().getSharedPreferences("cashweave-native-backup", Context.MODE_PRIVATE);
    }

    private synchronized Operation acquire(PluginCall call, byte[] payload) {
        if (destroyed || active != null) { call.reject("BACKUP_BUSY"); return null; }
        // A tiny non-financial marker survives process death. It never contains
        // the JSON, file name, URI, balances, or any user-entered content.
        if (!markers().edit().putBoolean(INTERRUPTION, true).commit()) {
            call.reject("BACKUP_STATE_FAILED"); return null;
        }
        active = new Operation(call, payload);
        return active;
    }

    private synchronized Operation current(PluginCall call) {
        return active != null && active.call == call ? active : null;
    }

    private boolean finish(Operation operation, JSObject result, String error, boolean interrupted) {
        if (!operation.settled.compareAndSet(false, true)) return false;
        if (operation.timeout != null) operation.timeout.cancel(false);
        synchronized (this) {
            operation.payload = null;
            if (active == operation) active = null;
            if (!interrupted) markers().edit().putBoolean(INTERRUPTION, false).commit();
        }
        if (error == null) operation.call.resolve(result);
        else operation.call.reject(error);
        return true;
    }

    private void cancel(Operation operation, String error) {
        if (!finish(operation, null, error, true)) return;
        if (operation.task != null) operation.task.cancel(true);
        // Provider cancellation/close may itself stall. Never run either on the
        // Capacitor dispatcher, the main thread, or the timeout scheduler.
        try {
            cleanupExecutor.execute(() -> {
                operation.signal.cancel();
                Closeable stream = operation.stream;
                if (stream != null) try { stream.close(); } catch (Exception ignored) {}
            });
        } catch (java.util.concurrent.RejectedExecutionException ignored) {
            // Destruction may have closed the cleanup executor. The operation
            // is already rejected; never block UI waiting for a provider.
        }
    }

    private void interruption(PluginCall call) {
        restoredInterruption = true;
        if (call != null) call.reject("BACKUP_WRITE_INTERRUPTED");
        notifyListeners("backupInterrupted", new JSObject(), true);
    }

    private void launch(Operation operation, Intent intent, String callback) {
        getActivity().runOnUiThread(() -> {
            if (destroyed || operation.settled.get()) return;
            try { startActivityForResult(operation.call, intent, callback); }
            catch (ActivityNotFoundException | SecurityException | IllegalStateException exception) {
                finish(operation, null, "BACKUP_PICKER_UNAVAILABLE", false);
            }
        });
    }

    @PluginMethod
    public void saveJson(PluginCall call) {
        String text = call.getString("text");
        // getData returns the original mutable options. Bridge.saveInstanceState
        // serializes it separately, so remove BEFORE saving/launching the call.
        call.getData().remove("text");
        String filename = call.getString("filename", "cashweave-backup.json");
        if (text == null || text.isEmpty()) { call.reject("BACKUP_EMPTY"); return; }
        byte[] payload = text.getBytes(StandardCharsets.UTF_8);
        if (payload.length > MAX_BYTES) { call.reject("BACKUP_TOO_LARGE"); return; }
        if (!filename.matches("[A-Za-z0-9][A-Za-z0-9._-]{0,119}\\.json")) { call.reject("BACKUP_FILENAME_INVALID"); return; }
        // The bounded display name need not be in saved options either.
        call.getData().remove("filename");
        Operation operation = acquire(call, payload);
        if (operation == null) return;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE, filename);
        intent.putExtra(Intent.EXTRA_LOCAL_ONLY, true);
        launch(operation, intent, "saveResult");
    }

    private Uri selectedUri(Operation operation, ActivityResult result) {
        if (result.getResultCode() != Activity.RESULT_OK) {
            finish(operation, new JSObject().put("cancelled", true), null, false);
            return null;
        }
        Uri uri = result.getData() == null ? null : result.getData().getData();
        if (uri == null || !"content".equals(uri.getScheme())) {
            finish(operation, null, "BACKUP_LOCATION_INVALID", false);
            return null;
        }
        return uri;
    }

    private void submit(Operation operation, Runnable runnable) {
        if (destroyed || operation.settled.get()) return;
        try {
            operation.task = ioExecutor.submit(runnable);
            operation.timeout = timeoutExecutor.schedule(() -> cancel(operation, "BACKUP_IO_TIMEOUT"), IO_TIMEOUT_SECONDS, TimeUnit.SECONDS);
            if (operation.settled.get()) operation.timeout.cancel(false);
        } catch (java.util.concurrent.RejectedExecutionException exception) {
            finish(operation, null, "BACKUP_WRITE_INTERRUPTED", true);
        }
    }

    private void checkActive(Operation operation) throws java.io.InterruptedIOException {
        if (destroyed || operation.settled.get() || Thread.currentThread().isInterrupted()) throw new java.io.InterruptedIOException();
    }

    @ActivityCallback
    private void saveResult(PluginCall call, ActivityResult result) {
        Operation operation = current(call);
        if (operation == null) { interruption(call); return; }
        Uri uri = selectedUri(operation, result);
        if (uri == null) return;
        submit(operation, () -> {
            try {
                checkActive(operation);
                byte[] bytes = operation.payload;
                if (bytes == null) { finish(operation, null, "BACKUP_WRITE_INTERRUPTED", true); return; }
                ParcelFileDescriptor descriptor = getContext().getContentResolver().openFileDescriptor(uri, "wt", operation.signal);
                if (descriptor == null) throw new java.io.IOException();
                try (OutputStream stream = new ParcelFileDescriptor.AutoCloseOutputStream(descriptor)) {
                    operation.stream = stream;
                    for (int offset = 0; offset < bytes.length; offset += 8192) {
                        checkActive(operation);
                        stream.write(bytes, offset, Math.min(8192, bytes.length - offset));
                    }
                    stream.flush();
                } finally { operation.stream = null; }
                checkActive(operation);
                // Success only AFTER close. Atomic settlement prevents a late
                // provider completion from reporting success after interruption.
                finish(operation, new JSObject().put("saved", true).put("bytes", bytes.length), null, false);
            } catch (Exception exception) { finish(operation, null, "BACKUP_WRITE_FAILED", false); }
        });
    }

    @PluginMethod
    public void openJson(PluginCall call) {
        Operation operation = acquire(call, null);
        if (operation == null) return;
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] { "application/json", "text/plain", "application/octet-stream" });
        intent.putExtra(Intent.EXTRA_LOCAL_ONLY, true);
        launch(operation, intent, "openResult");
    }

    @ActivityCallback
    private void openResult(PluginCall call, ActivityResult result) {
        Operation operation = current(call);
        if (operation == null) { interruption(call); return; }
        Uri uri = selectedUri(operation, result);
        if (uri == null) return;
        submit(operation, () -> {
            try {
                checkActive(operation);
                ParcelFileDescriptor descriptor = getContext().getContentResolver().openFileDescriptor(uri, "r", operation.signal);
                if (descriptor == null) throw new java.io.IOException();
                byte[] bytes;
                try (InputStream input = new ParcelFileDescriptor.AutoCloseInputStream(descriptor);
                     ByteArrayOutputStream buffer = new ByteArrayOutputStream()) {
                    operation.stream = input;
                    byte[] chunk = new byte[8192];
                    int size;
                    while ((size = input.read(chunk)) != -1) {
                        checkActive(operation);
                        if (buffer.size() + size > MAX_BYTES) { finish(operation, null, "BACKUP_TOO_LARGE", false); return; }
                        buffer.write(chunk, 0, size);
                    }
                    bytes = buffer.toByteArray();
                } finally { operation.stream = null; }
                checkActive(operation);
                if (bytes.length == 0) { finish(operation, null, "BACKUP_EMPTY", false); return; }
                String text = StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes)).toString();
                finish(operation, new JSObject().put("text", text).put("bytes", bytes.length), null, false);
            } catch (Exception exception) { finish(operation, null, "BACKUP_READ_FAILED", false); }
        });
    }

    @Override
    protected Bundle saveInstanceState() {
        Bundle state = new Bundle();
        synchronized (this) { state.putBoolean(INTERRUPTION, active != null); }
        return state;
    }

    @Override
    protected void restoreState(Bundle state) {
        if (state.getBoolean(INTERRUPTION, false)) interruption(null);
    }

    @PluginMethod
    public void consumeInterruption(PluginCall call) {
        boolean interrupted;
        synchronized (this) {
            interrupted = restoredInterruption || (active == null && markers().getBoolean(INTERRUPTION, false));
            restoredInterruption = false;
            if (active == null) markers().edit().putBoolean(INTERRUPTION, false).commit();
        }
        call.resolve(new JSObject().put("interrupted", interrupted));
    }

    @PluginMethod
    public void ready(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            ((MainActivity) getActivity()).markNativeReady();
            call.resolve();
        });
    }

    @PluginMethod
    public void acknowledgeBack(PluginCall call) {
        Integer requestId = call.getInt("requestId");
        getActivity().runOnUiThread(() -> {
            if (requestId != null) ((MainActivity) getActivity()).acknowledgeBack(requestId);
            call.resolve();
        });
    }

    @PluginMethod
    public void minimize(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            getActivity().moveTaskToBack(true);
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        destroyed = true;
        Operation operation;
        synchronized (this) { operation = active; }
        if (operation != null) cancel(operation, "BACKUP_WRITE_INTERRUPTED");
        ioExecutor.shutdownNow();
        timeoutExecutor.shutdownNow();
        cleanupExecutor.shutdown();
    }
}
