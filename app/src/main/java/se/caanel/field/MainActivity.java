package se.caanel.field;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;
import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;

import java.io.OutputStream;

public class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 501;
    private static final int CAMERA_REQUEST = 502;
    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private Uri pendingCameraUri;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Use the long-supported immersive flags instead of newer WindowInsets calls.
        // This is deliberately conservative for Samsung/Android compatibility.
        applyImmersiveMode();

        webView = new WebView(this);
        webView.setBackgroundColor(Color.BLACK);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);

        WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public android.webkit.WebResourceResponse shouldInterceptRequest(
                    WebView view, android.webkit.WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                applyImmersiveMode();
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView webView,
                                             ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;

                boolean wantsImage = false;
                String[] acceptTypes = params.getAcceptTypes();
                if (acceptTypes != null) {
                    for (String type : acceptTypes) {
                        if (type != null && type.toLowerCase().startsWith("image/")) { wantsImage = true; break; }
                    }
                }

                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                if (wantsImage) {
                    intent.setType("image/*");
                } else {
                    intent.setType("*/*");
                    intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                            "application/pdf",
                            "application/zip",
                            "application/x-zip-compressed"
                    });
                }
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,
                        params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                return true;
            }
        });

        webView.addJavascriptInterface(new AndroidBridge(), "Android");
        webView.loadUrl("https://appassets.androidplatform.net/assets/www/index.html");
    }

    private void applyImmersiveMode() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY |
                View.SYSTEM_UI_FLAG_FULLSCREEN |
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION |
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        );
    }

    @Override
    protected void onResume() {
        super.onResume();
        applyImmersiveMode();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyImmersiveMode();
    }

    @Override
    public void onBackPressed() {
        if (webView == null) { super.onBackPressed(); return; }
        webView.evaluateJavascript("(window.ekisBack?window.ekisBack():false)", value -> {
            if (!"true".equals(value)) {
                if (webView.canGoBack()) webView.goBack(); else MainActivity.super.onBackPressed();
            }
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == CAMERA_REQUEST) {
            if (resultCode == Activity.RESULT_OK && pendingCameraUri != null) {
                deliverCameraPhoto(pendingCameraUri);
            } else if (webView != null) {
                webView.evaluateJavascript("window.ekisCameraCancelled&&window.ekisCameraCancelled()", null);
            }
            pendingCameraUri = null;
            applyImmersiveMode();
            return;
        }

        if (requestCode != FILE_CHOOSER_REQUEST || filePathCallback == null) return;

        Uri[] result = null;
        if (resultCode == Activity.RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                int count = data.getClipData().getItemCount();
                result = new Uri[count];
                for (int i = 0; i < count; i++) {
                    result[i] = data.getClipData().getItemAt(i).getUri();
                }
            } else if (data.getData() != null) {
                result = new Uri[]{data.getData()};
            }
        }

        filePathCallback.onReceiveValue(result);
        filePathCallback = null;
        applyImmersiveMode();
    }

    private void launchNativeCamera() {
        try {
            File dir = new File(getCacheDir(), "camera");
            if (!dir.exists()) dir.mkdirs();
            File photo = new File(dir, "ata_" + System.currentTimeMillis() + ".jpg");
            pendingCameraUri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", photo);
            Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            intent.putExtra(MediaStore.EXTRA_OUTPUT, pendingCameraUri);
            intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            if (intent.resolveActivity(getPackageManager()) == null) throw new Exception("Ingen kameraapp hittades");
            startActivityForResult(intent, CAMERA_REQUEST);
        } catch (Exception e) {
            pendingCameraUri = null;
            Toast.makeText(this, "Kunde inte starta kameran", Toast.LENGTH_LONG).show();
            if (webView != null) webView.evaluateJavascript("window.ekisCameraCancelled&&window.ekisCameraCancelled()", null);
        }
    }

    private void deliverCameraPhoto(Uri uri) {
        new Thread(() -> {
            try (InputStream input = getContentResolver().openInputStream(uri)) {
                if (input == null) throw new Exception("Kunde inte läsa kamerabilden");
                Bitmap source = BitmapFactory.decodeStream(input);
                if (source == null) throw new Exception("Ogiltig kamerabild");
                int w = source.getWidth(), h = source.getHeight();
                int max = Math.max(w, h);
                Bitmap output = source;
                if (max > 1920) {
                    float scale = 1920f / max;
                    output = Bitmap.createScaledBitmap(source, Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)), true);
                }
                ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                output.compress(Bitmap.CompressFormat.JPEG, 84, bytes);
                String dataUrl = "data:image/jpeg;base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP);
                if (output != source) output.recycle();
                source.recycle();
                String js = "window.ekisCameraPhoto&&window.ekisCameraPhoto(" + org.json.JSONObject.quote(dataUrl) + ")";
                runOnUiThread(() -> webView.evaluateJavascript(js, null));
            } catch (Exception e) {
                runOnUiThread(() -> {
                    Toast.makeText(MainActivity.this, "Kunde inte läsa kamerabilden", Toast.LENGTH_LONG).show();
                    webView.evaluateJavascript("window.ekisCameraCancelled&&window.ekisCameraCancelled()", null);
                });
            }
        }).start();
    }

    public class AndroidBridge {
        @JavascriptInterface
        public void capturePhoto() {
            runOnUiThread(() -> launchNativeCamera());
        }

        @JavascriptInterface
        public void shareBase64(String filename, String base64Data, String mimeType) {
            new Thread(() -> {
                try {
                    String pure = base64Data;
                    int comma = pure.indexOf(',');
                    if (comma >= 0) pure = pure.substring(comma + 1);
                    byte[] bytes = Base64.decode(pure, Base64.DEFAULT);
                    File dir = new File(getCacheDir(), "share"); dir.mkdirs();
                    File file = new File(dir, filename.replaceAll("[^a-zA-Z0-9._\\-]", "_"));
                    try (FileOutputStream out = new FileOutputStream(file)) { out.write(bytes); }
                    Uri uri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".fileprovider", file);
                    Intent send = new Intent(Intent.ACTION_SEND); send.setType(mimeType); send.putExtra(Intent.EXTRA_STREAM, uri); send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    runOnUiThread(() -> startActivity(Intent.createChooser(send, "Dela ÄTA-underlag")));
                } catch (Exception e) { runOnUiThread(() -> Toast.makeText(MainActivity.this, "Kunde inte dela filen", Toast.LENGTH_LONG).show()); }
            }).start();
        }

        @JavascriptInterface
        public void saveBase64(String filename, String base64Data) {
            new Thread(() -> {
                try {
                    String pure = base64Data;
                    int comma = pure.indexOf(',');
                    if (comma >= 0) pure = pure.substring(comma + 1);
                    byte[] bytes = Base64.decode(pure, Base64.DEFAULT);

                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
                    values.put(MediaStore.Downloads.MIME_TYPE,
                            filename.toLowerCase().endsWith(".zip")
                                    ? "application/zip"
                                    : "application/octet-stream");
                    values.put(MediaStore.Downloads.RELATIVE_PATH,
                            Environment.DIRECTORY_DOWNLOADS + "/EKIS FIELD");

                    Uri uri = getContentResolver().insert(
                            MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri == null) throw new Exception("Kunde inte skapa fil");

                    try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                        if (out == null) throw new Exception("Kunde inte öppna fil");
                        out.write(bytes);
                    }

                    runOnUiThread(() -> Toast.makeText(
                            MainActivity.this,
                            "Sparad i Hämtade filer / EKIS FIELD",
                            Toast.LENGTH_LONG).show());
                } catch (Exception e) {
                    runOnUiThread(() -> Toast.makeText(
                            MainActivity.this,
                            "Kunde inte spara filen",
                            Toast.LENGTH_LONG).show());
                }
            }).start();
        }
    }
}
