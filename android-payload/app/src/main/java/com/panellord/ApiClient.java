package com.panellord;

import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class ApiClient {
    private static final String TAG = "ApiClient";

    /** POST JSON string to VPS endpoint */
    public static String postJson(String endpoint, org.json.JSONObject body) throws IOException {
        return postJson(endpoint, body.toString());
    }

    public static String postJson(String endpoint, String jsonBody) throws IOException {
        URL url = new URL(Config.VPS_URL + endpoint);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setRequestProperty("X-Token", Config.USER_TOKEN);
        conn.setDoOutput(true);
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(15000);

        try (OutputStream os = conn.getOutputStream()) {
            os.write(jsonBody.getBytes(StandardCharsets.UTF_8));
        }

        int code = conn.getResponseCode();
        InputStream is = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
        if (is == null) return "";
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] tmp = new byte[4096]; int n;
        while ((n = is.read(tmp)) != -1) buf.write(tmp, 0, n);
        return buf.toString("UTF-8");
    }

    /** POST JPEG bytes (for screen/camera frame) */
    public static void postJpeg(String endpoint, byte[] jpegBytes) throws IOException {
        postBytes(endpoint, jpegBytes, "image/jpeg");
    }

    /** POST raw bytes with custom content type */
    public static void postBytes(String endpoint, byte[] data, String contentType) throws IOException {
        URL url = new URL(Config.VPS_URL + endpoint);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Content-Type", contentType);
        conn.setRequestProperty("X-Token", Config.USER_TOKEN);
        conn.setDoOutput(true);
        conn.setConnectTimeout(10000);
        conn.setReadTimeout(10000);
        try (OutputStream os = conn.getOutputStream()) { os.write(data); }
        conn.getResponseCode();
    }

    /** GET request */
    public static String get(String endpoint) throws IOException {
        URL url = new URL(Config.VPS_URL + endpoint);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod("GET");
        conn.setRequestProperty("X-Token", Config.USER_TOKEN);
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(15000);

        int code = conn.getResponseCode();
        InputStream is = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
        if (is == null) return "";
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] tmp = new byte[4096]; int n;
        while ((n = is.read(tmp)) != -1) buf.write(tmp, 0, n);
        return buf.toString("UTF-8");
    }
}
