package app.cashweave.offline.trial;

/** Initial Activity startup only. Clock-injected; no Android, storage or I/O. */
final class StartupState {
    static final long TIMEOUT_MS = 15000;
    private long deadline;
    private boolean started, ready, foreground, destroyed;
    void start(long now) {
        if (started || destroyed) return;
        started = true;
        deadline = now + TIMEOUT_MS;
    }
    boolean isReady() { return ready; }
    boolean isForeground() { return foreground && !destroyed; }
    void foreground(boolean value) { if (!destroyed) foreground = value; }
    boolean markReady() {
        if (!started || destroyed) return false;
        ready = true;
        return true;
    }
    long remaining(long now) { return Math.max(0, deadline - now); }
    boolean shouldShow(long now) {
        return started && !destroyed && foreground && !ready && now >= deadline;
    }
    void destroy() { destroyed = true; foreground = false; ready = false; }
}
