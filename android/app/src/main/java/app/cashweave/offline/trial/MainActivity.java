package app.cashweave.offline.trial;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.activity.EdgeToEdge;
import androidx.activity.OnBackPressedCallback;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import java.util.HashSet;
import java.util.Set;

public class MainActivity extends BridgeActivity {
    private final Handler backHandler = new Handler(Looper.getMainLooper());
    private final StartupState startup = new StartupState();
    private final Set<String> reportedStages = new HashSet<>();
    private final Runnable startupCheck = this::showStartupFailure;
    private View startupFallback;
    private Integer previousWebViewAccessibility;
    private long startedAt;
    private int backSequence;
    private int pendingBack;

    public void markNativeReady() {
        if (!startup.markReady()) return;
        stage("JS_READY");
        backHandler.removeCallbacks(startupCheck);
        hideStartupFailure();
    }
    private void stage(String value) {
        // Only fixed call-site constants and monotonic elapsed time; no web/user data.
        if (reportedStages.size() < 16 && reportedStages.add(value)) {
            Log.i("CashWeaveStartup", value + " elapsedMs=" + (SystemClock.elapsedRealtime() - startedAt));
        }
    }
    private void armStartupCheck() {
        backHandler.removeCallbacks(startupCheck);
        if (startup.isForeground() && !startup.isReady()) {
            backHandler.postDelayed(startupCheck, startup.remaining(SystemClock.elapsedRealtime()));
        }
    }
    private void hideStartupFailure() {
        if (startupFallback != null) {
            if (startupFallback.getParent() instanceof ViewGroup) ((ViewGroup) startupFallback.getParent()).removeView(startupFallback);
            startupFallback = null;
            if (getBridge() != null && previousWebViewAccessibility != null) getBridge().getWebView().setImportantForAccessibility(previousWebViewAccessibility);
            previousWebViewAccessibility = null;
        }
    }
    private void showStartupFailure() {
        if (isFinishing() || isDestroyed() || !startup.shouldShow(SystemClock.elapsedRealtime()) || startupFallback != null) return;
        stage("STARTUP_TIMEOUT");
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setClickable(true);
        panel.setFocusableInTouchMode(true);
        panel.setGravity(android.view.Gravity.CENTER_VERTICAL);
        panel.setBackgroundColor(0xfff5f8f3);
        int padding = Math.round(24 * getResources().getDisplayMetrics().density);
        ViewCompat.setOnApplyWindowInsetsListener(panel, (view, insets) -> {
            androidx.core.graphics.Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            view.setPadding(padding + bars.left, padding + bars.top, padding + bars.right, padding + bars.bottom);
            return insets;
        });
        TextView message = new TextView(this);
        message.setTextSize(18);
        message.setTextColor(0xff183c33);
        message.setText(R.string.startup_not_ready);
        panel.addView(message);
        Button leave = new Button(this);
        leave.setText(R.string.startup_background);
        leave.setOnClickListener(view -> moveTaskToBack(true));
        panel.addView(leave);
        if (getBridge() != null) {
            WebView webView = getBridge().getWebView();
            previousWebViewAccessibility = webView.getImportantForAccessibility();
            webView.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
        }
        startupFallback = panel;
        FrameLayout content = findViewById(android.R.id.content);
        content.addView(panel, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        ViewCompat.requestApplyInsets(panel);
        message.setFocusableInTouchMode(true);
        message.requestFocus();
        panel.announceForAccessibility(message.getText());
    }
    public void acknowledgeBack(int requestId) {
        if (pendingBack == requestId) pendingBack = 0;
    }
    @Override
    public void onCreate(Bundle savedInstanceState) {
        startedAt = SystemClock.elapsedRealtime();
        startup.start(startedAt);
        stage("ACTIVITY_CREATED");
        registerPlugin(LocalBackupPlugin.class);
        // Builder attaches listeners after constructing Bridge; the independent
        // watchdog below also covers a launch with no page callback at all.
        bridgeBuilder.addWebViewListener(new WebViewListener() {
            @Override public void onPageStarted(WebView view) { stage("PAGE_STARTED"); }
            @Override public void onPageCommitVisible(WebView view, String ignoredUrl) { stage("PAGE_COMMIT_VISIBLE"); }
            @Override public void onPageLoaded(WebView view) { stage("PAGE_LOADED"); }
            @Override public void onReceivedError(WebView view) { stage("LOAD_ERROR"); }
            @Override public void onReceivedHttpError(WebView view) { stage("HTTP_ERROR"); }
            // Renderer-gone remains Capacitor's default unhandled behavior.
        });
        super.onCreate(savedInstanceState);
        stage(getBridge() != null ? "BRIDGE_CREATED" : "BRIDGE_UNAVAILABLE");
        EdgeToEdge.enable(this);
        WebView.setWebContentsDebuggingEnabled(false);
        armStartupCheck();
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (getBridge() == null || !startup.isReady()) { moveTaskToBack(true); return; }
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
    @Override public void onResume() {
        super.onResume();
        startup.foreground(true);
        armStartupCheck();
    }
    @Override public void onPause() {
        startup.foreground(false);
        backHandler.removeCallbacks(startupCheck);
        super.onPause();
    }
    @Override
    public void onDestroy() {
        startup.destroy();
        backHandler.removeCallbacksAndMessages(null);
        hideStartupFailure();
        super.onDestroy();
    }
}
