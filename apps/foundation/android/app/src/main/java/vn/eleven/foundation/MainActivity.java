package vn.eleven.foundation;

import android.app.Activity;
import android.os.Bundle;
import android.graphics.Color;
import android.view.View;
import android.widget.*;
import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private volatile boolean destroyed;
    private volatile HttpURLConnection active;
    private TextView status;
    private Button check;
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private TextView text(LinearLayout parent, String value, int size) {
        TextView view = new TextView(this); view.setText(value); view.setTextSize(size);
        view.setTextColor(Color.rgb(42,42,46)); view.setPadding(0,dp(12),0,dp(12));
        parent.addView(view); return view;
    }
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        ScrollView scroll = new ScrollView(this);
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(24),dp(24),dp(24),dp(24)); root.setBackgroundColor(Color.rgb(242,241,238)); scroll.addView(root);
        // Fit status/navigation bar insets on Android 15; do not place controls behind system bars.
        scroll.setOnApplyWindowInsetsListener((v, insets) -> {
            v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom()); return insets;
        });
        text(root, "Môi trường thử nghiệm", 14);
        text(root, BuildConfig.BRAND + " · " + BuildConfig.AUDIENCE, 28);
        text(root, BuildConfig.TAGLINE, 18);
        text(root, "Bước 1 · Khung ứng dụng", 22);
        text(root, "Kiểm tra kết nối trước khi thử nghiệp vụ tài khoản.", 16);
        text(root, BuildConfig.API_ORIGIN.isEmpty() ? "Chưa cấu hình địa chỉ backend." : BuildConfig.API_ORIGIN, 14);
        check = new Button(this); check.setText("Kiểm tra kết nối"); check.setMinHeight(dp(48));
        check.setTextColor(Color.rgb(42,42,46)); check.setBackgroundTintList(android.content.res.ColorStateList.valueOf(Color.rgb(216,173,24))); root.addView(check);
        status = text(root, "Chưa kiểm tra.", 16); status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        text(root, "Bản này chưa có đăng nhập hoặc phân quyền. Tên ứng dụng không cấp quyền cho tài khoản.", 16);
        check.setOnClickListener(v -> {
            if (BuildConfig.API_ORIGIN.isEmpty()) { status.setText("Chưa cấu hình backend. Liên hệ người triển khai."); return; }
            check.setEnabled(false); status.setText("Đang kiểm tra…");
            executor.execute(() -> {
                String message;
                try {
                    boolean live = health("live", "ok");
                    boolean ready = live && health("ready", "ready");
                    message = ready ? "API và database sẵn sàng." : "API hoặc database chưa sẵn sàng.";
                } catch (Exception e) { message = "Không kết nối được. Kiểm tra mạng rồi thử lại."; }
                final String result = message;
                runOnUiThread(() -> { if (!destroyed) { status.setText(result); check.setEnabled(true); } });
            });
        });
        setContentView(scroll);
    }
    private boolean health(String path, String expected) throws Exception {
        if (destroyed) return false;
        HttpURLConnection connection = (HttpURLConnection) new URL(BuildConfig.API_ORIGIN + "/v1/health/" + path).openConnection();
        active = connection;
        try {
            connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(15000); connection.setReadTimeout(15000); connection.setUseCaches(false);
            if (connection.getResponseCode() != 200) return false;
            try (InputStream stream = connection.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[1024]; int count;
                while ((count = stream.read(buffer)) != -1) { if (out.size() + count > 8192) return false; out.write(buffer,0,count); }
                JSONObject body = new JSONObject(out.toString(StandardCharsets.UTF_8.name()));
                return expected.equals(body.getJSONObject("data").getString("status"));
            }
        } finally { connection.disconnect(); active = null; }
    }
    @Override public void onDestroy() { destroyed = true; HttpURLConnection c = active; if (c != null) c.disconnect(); executor.shutdownNow(); super.onDestroy(); }
}
