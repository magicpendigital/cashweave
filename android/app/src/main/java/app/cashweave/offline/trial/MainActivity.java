package app.cashweave.offline.trial;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;
import androidx.activity.EdgeToEdge;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private final Handler backHandler = new Handler(Looper.getMainLooper());
    private boolean nativeReady;
    private int backSequence;
    private int pendingBack;

    public void markNativeReady() { nativeReady = true; }
    public void acknowledgeBack(int requestId) {
        if (pendingBack == requestId) pendingBack = 0;
    }
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LocalBackupPlugin.class);
        super.onCreate(savedInstanceState);
        EdgeToEdge.enable(this);
        WebView.setWebContentsDebuggingEnabled(false);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (getBridge() == null || !nativeReady) { moveTaskToBack(true); return; }
                final int requestId = ++backSequence;
                pendingBack = requestId;
                backHandler.postDelayed(() -> {
                    if (pendingBack == requestId) {
                        pendingBack = 0;
                        moveTaskToBack(true);
                    }
                }, 1500);
                getBridge().triggerWindowJSEvent("cashweaveNativeBack", "{\"requestId\":" + requestId + "}");
            }
        });
    }

    @Override
    public void onDestroy() {
        backHandler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
}
