package app.cashweave.offline.trial;

public final class StartupStateBehaviorTest {
    private static int checks;
    private static void check(boolean value, String name) {
        if (!value) throw new AssertionError(name);
        checks++;
    }
    public static void main(String[] args) {
        StartupState blank = new StartupState();
        check(!blank.markReady(), "no ready before startup");
        blank.start(100);
        blank.foreground(true);
        check(!blank.shouldShow(15099), "no premature deadline");
        check(blank.shouldShow(15100), "no page callbacks still reach timeout");
        blank.start(10000);
        check(blank.shouldShow(15100), "page or repeated start cannot postpone initial deadline");
        check(blank.remaining(15100) == 0, "expired deadline never schedules negative delay");
        check(blank.markReady() && !blank.shouldShow(20000), "genuine app ready dismisses initial failure");
        blank.start(21000);
        check(blank.isReady() && !blank.shouldShow(90000), "later document navigation does not rearm initial policy");

        StartupState background = new StartupState();
        background.start(0);
        check(!background.shouldShow(15000), "never show over a background activity");
        background.foreground(true);
        check(background.shouldShow(15000), "expired initial startup visible only after resume");
        background.foreground(false);
        check(!background.shouldShow(20000), "pause suppresses fallback");
        check(background.markReady(), "completion while background remains valid");
        background.foreground(true);
        check(!background.shouldShow(30000), "resume after ready does not warn");

        StartupState destroyed = new StartupState();
        destroyed.start(0);
        destroyed.foreground(true);
        destroyed.destroy();
        destroyed.foreground(true);
        check(!destroyed.markReady(), "delayed native ready after destruction rejected");
        check(!destroyed.shouldShow(90000) && !destroyed.isForeground(), "destroy cancels foreground timeout lifecycle");
        destroyed.start(90000);
        check(!destroyed.markReady() && !destroyed.shouldShow(200000), "destroyed instance cannot restart policy");
        System.out.println("PASS " + checks + " startup policy behavior checks");
    }
}
