package com.panellord;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

public class WatchdogJobService extends JobService {

    private static final int JOB_ID = 8888;

    /** Schedule (or re-schedule) the watchdog job. Call from MainService.onCreate(). */
    public static void schedule(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) return;
        try {
            JobScheduler js = (JobScheduler) ctx.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            if (js == null) return;
            // Already scheduled? skip
            for (JobInfo j : js.getAllPendingJobs()) {
                if (j.getId() == JOB_ID) return;
            }
            JobInfo job = new JobInfo.Builder(JOB_ID,
                    new ComponentName(ctx, WatchdogJobService.class))
                    .setMinimumLatency(5 * 60 * 1000L)          // at least 5 min
                    .setOverrideDeadline(6 * 60 * 1000L)         // fire within 6 min
                    .setPersisted(true)                           // survives reboot
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_NONE)
                    .build();
            js.schedule(job);
        } catch (Exception ignored) {}
    }

    @Override
    public boolean onStartJob(JobParameters params) {
        // Restart the main foreground service if it's not running
        try {
            Intent i = new Intent(this, MainService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(i);
            else startService(i);
        } catch (Exception ignored) {}
        // Re-schedule for the next cycle
        schedule(this);
        jobFinished(params, false);
        return false;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return true; // reschedule on failure
    }
}
