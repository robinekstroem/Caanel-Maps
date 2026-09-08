package se.caanel.field.ar;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.opengl.GLES20;
import android.opengl.GLSurfaceView;
import android.opengl.Matrix;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.google.ar.core.Anchor;
import com.google.ar.core.ArCoreApk;
import com.google.ar.core.Camera;
import com.google.ar.core.Config;
import com.google.ar.core.Frame;
import com.google.ar.core.HitResult;
import com.google.ar.core.Plane;
import com.google.ar.core.Point;
import com.google.ar.core.Pose;
import com.google.ar.core.Session;
import com.google.ar.core.TrackingState;
import com.google.ar.core.exceptions.CameraNotAvailableException;
import com.google.ar.core.exceptions.UnavailableException;

import java.util.ArrayList;
import java.util.List;

import javax.microedition.khronos.egl.EGLConfig;
import javax.microedition.khronos.opengles.GL10;

/**
 * Real-world measuring with ARCore.
 *
 * ARCore tracks the room in 3D using the camera together with the motion
 * sensors, so a tapped point becomes an anchor with true world coordinates that
 * stays put when the phone moves. The distance between two anchors is therefore
 * a real distance in metres — this is what a plain photo can never give, since
 * a single image has no scale of its own.
 */
public class MeasureActivity extends Activity implements GLSurfaceView.Renderer {

    public static final String EXTRA_ACCENT = "accent";
    public static final String EXTRA_THEME = "theme";
    public static final String RESULT_METERS = "meters";

    private static final int CAMERA_PERMISSION_REQUEST = 4711;

    private GLSurfaceView surfaceView;
    private MeasureOverlayView overlay;
    private TextView hint;
    private TextView readout;
    private Button undoBtn, useBtn;

    private Session session;
    private final CameraBackgroundRenderer background = new CameraBackgroundRenderer();
    private boolean sessionResumed = false;
    private boolean glReady = false;

    private final List<Anchor> anchors = new ArrayList<>();
    private volatile boolean tapPending = false;
    private int accentColor = Color.parseColor("#ff6a00");
    // Chrome colours are derived from the theme so the AR view matches the rest
    // of the app. They were hardcoded dark, which looked wrong in the light theme.
    private boolean lightTheme = false;
    private int chromeBg, chromeBgSoft, chromeText, chromeBtn, chromeBtnText;
    private volatile double lastMeters = -1;

    private final float[] viewMatrix = new float[16];
    private final float[] projMatrix = new float[16];
    private final float[] viewProj = new float[16];

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String accent = getIntent().getStringExtra(EXTRA_ACCENT);
        if (accent != null) {
            try { accentColor = Color.parseColor(accent.trim()); } catch (Exception ignored) { }
        }
        lightTheme = "light".equalsIgnoreCase(getIntent().getStringExtra(EXTRA_THEME));
        if (lightTheme) {
            chromeBg = Color.parseColor("#f2f3f5");
            chromeBgSoft = Color.parseColor("#e8eaee");
            chromeText = Color.parseColor("#14161a");
            chromeBtn = Color.parseColor("#dfe2e7");
            chromeBtnText = Color.parseColor("#14161a");
        } else if ("sky".equalsIgnoreCase(getIntent().getStringExtra(EXTRA_THEME))) {
            chromeBg = Color.parseColor("#071a33");
            chromeBgSoft = Color.parseColor("#0e2748");
            chromeText = Color.parseColor("#eaf4ff");
            chromeBtn = Color.parseColor("#143156");
            chromeBtnText = Color.parseColor("#eaf4ff");
        } else {
            chromeBg = Color.parseColor("#0b0b0c");
            chromeBgSoft = Color.parseColor("#101012");
            chromeText = Color.WHITE;
            chromeBtn = Color.parseColor("#26262b");
            chromeBtnText = Color.WHITE;
        }
        setContentView(buildUi());

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this,
                    new String[]{Manifest.permission.CAMERA}, CAMERA_PERMISSION_REQUEST);
        }
    }

    private View buildUi() {
        float d = getResources().getDisplayMetrics().density;
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);

        surfaceView = new GLSurfaceView(this);
        surfaceView.setPreserveEGLContextOnPause(true);
        surfaceView.setEGLContextClientVersion(2);
        surfaceView.setEGLConfigChooser(8, 8, 8, 8, 16, 0);
        surfaceView.setRenderer(this);
        surfaceView.setRenderMode(GLSurfaceView.RENDERMODE_CONTINUOUSLY);
        root.addView(surfaceView, new FrameLayout.LayoutParams(-1, -1));

        overlay = new MeasureOverlayView(this);
        overlay.applyAccent(accentColor);
        overlay.applyChrome(lightTheme);
        root.addView(overlay, new FrameLayout.LayoutParams(-1, -1));
        // A tap always measures at the centre reticle rather than the finger, so
        // a thumb never covers the exact point being placed — the same reason the
        // drawing view shows a magnifier while measuring.
        overlay.setOnClickListener(v -> tapPending = true);

        hint = new TextView(this);
        hint.setText("Rör telefonen långsamt så AR-spårningen hittar rummet");
        hint.setTextColor(chromeText);
        hint.setTextSize(14f);
        hint.setGravity(Gravity.CENTER);
        hint.setPadding((int) (16 * d), (int) (10 * d), (int) (16 * d), (int) (10 * d));
        hint.setBackgroundColor(withAlpha(chromeBgSoft, 0xB3));
        FrameLayout.LayoutParams hp = new FrameLayout.LayoutParams(-1, -2);
        hp.gravity = Gravity.TOP;
        hp.setMargins((int) (14 * d), (int) (44 * d), (int) (14 * d), 0);
        root.addView(hint, hp);

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.VERTICAL);
        bar.setGravity(Gravity.CENTER_HORIZONTAL);
        bar.setPadding((int) (18 * d), (int) (16 * d), (int) (18 * d), (int) (28 * d));
        bar.setBackgroundColor(withAlpha(chromeBg, 0xCC));

        readout = new TextView(this);
        readout.setText("Tryck för punkt A");
        readout.setTextColor(chromeText);
        readout.setTextSize(26f);
        readout.setGravity(Gravity.CENTER);
        bar.addView(readout, new LinearLayout.LayoutParams(-1, -2));

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams rp = new LinearLayout.LayoutParams(-1, -2);
        rp.topMargin = (int) (14 * d);
        bar.addView(row, rp);

        undoBtn = styledButton("Ångra", false, d);
        undoBtn.setOnClickListener(v -> {
            if (!anchors.isEmpty()) {
                anchors.remove(anchors.size() - 1).detach();
                lastMeters = -1;
            }
        });
        row.addView(undoBtn, buttonParams(d));

        Button close = styledButton("Stäng", false, d);
        close.setOnClickListener(v -> { setResult(RESULT_CANCELED); finish(); });
        row.addView(close, buttonParams(d));

        useBtn = styledButton("Använd mått", true, d);
        useBtn.setEnabled(false);
        useBtn.setOnClickListener(v -> {
            if (lastMeters <= 0) return;
            Intent out = new Intent();
            out.putExtra(RESULT_METERS, lastMeters);
            setResult(RESULT_OK, out);
            finish();
        });
        row.addView(useBtn, buttonParams(d));

        FrameLayout.LayoutParams bp = new FrameLayout.LayoutParams(-1, -2);
        bp.gravity = Gravity.BOTTOM;
        root.addView(bar, bp);
        return root;
    }

    private static int withAlpha(int color, int alpha) {
        return Color.argb(alpha, Color.red(color), Color.green(color), Color.blue(color));
    }

    /** Keeps label text readable on both the orange and the bright green accent. */
    private static int bestContrast(int bg) {
        double lum = (0.299 * Color.red(bg) + 0.587 * Color.green(bg) + 0.114 * Color.blue(bg)) / 255.0;
        return lum > 0.6 ? Color.parseColor("#111111") : Color.WHITE;
    }

    private LinearLayout.LayoutParams buttonParams(float d) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, (int) (48 * d), 1f);
        p.setMargins((int) (5 * d), 0, (int) (5 * d), 0);
        return p;
    }

    private Button styledButton(String text, boolean primary, float d) {
        Button b = new Button(this);
        b.setText(text);
        b.setAllCaps(false);
        b.setTextSize(15f);
        b.setTextColor(primary ? bestContrast(accentColor) : chromeBtnText);
        b.setBackgroundColor(primary ? accentColor : chromeBtn);
        return b;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] p, @NonNull int[] r) {
        super.onRequestPermissionsResult(requestCode, p, r);
        if (requestCode == CAMERA_PERMISSION_REQUEST
                && (r.length == 0 || r[0] != PackageManager.PERMISSION_GRANTED)) {
            Toast.makeText(this, "Kameran behövs för att mäta", Toast.LENGTH_LONG).show();
            finish();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                != PackageManager.PERMISSION_GRANTED) return;

        if (session == null) {
            try {
                ArCoreApk.InstallStatus status = ArCoreApk.getInstance().requestInstall(this, true);
                if (status == ArCoreApk.InstallStatus.INSTALL_REQUESTED) return;
                session = new Session(this);
                Config config = session.getConfig();
                config.setFocusMode(Config.FocusMode.AUTO);
                config.setPlaneFindingMode(Config.PlaneFindingMode.HORIZONTAL_AND_VERTICAL);
                // Depth, where the device supports it, lets points land on
                // surfaces ARCore has not yet fitted a plane to — which is most
                // of a bare wall on a building site.
                if (session.isDepthModeSupported(Config.DepthMode.AUTOMATIC)) {
                    config.setDepthMode(Config.DepthMode.AUTOMATIC);
                }
                session.configure(config);
            } catch (UnavailableException e) {
                Toast.makeText(this, "AR stöds inte på den här telefonen", Toast.LENGTH_LONG).show();
                setResult(RESULT_CANCELED);
                finish();
                return;
            } catch (Exception e) {
                Toast.makeText(this, "Kunde inte starta AR: " + e.getMessage(), Toast.LENGTH_LONG).show();
                finish();
                return;
            }
        }
        try {
            session.resume();
            sessionResumed = true;
        } catch (CameraNotAvailableException e) {
            Toast.makeText(this, "Kameran är upptagen", Toast.LENGTH_LONG).show();
            session = null;
            finish();
            return;
        }
        surfaceView.onResume();
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (session != null && sessionResumed) {
            surfaceView.onPause();
            session.pause();
            sessionResumed = false;
        }
    }

    @Override
    protected void onDestroy() {
        for (Anchor a : anchors) a.detach();
        anchors.clear();
        if (session != null) { session.close(); session = null; }
        super.onDestroy();
    }

    // ---- GLSurfaceView.Renderer ----

    @Override
    public void onSurfaceCreated(GL10 gl, EGLConfig config) {
        GLES20.glClearColor(0f, 0f, 0f, 1f);
        background.createOnGlThread(this);
        glReady = true;
    }

    @Override
    public void onSurfaceChanged(GL10 gl, int width, int height) {
        GLES20.glViewport(0, 0, width, height);
        if (session != null) {
            session.setDisplayGeometry(getWindowManager().getDefaultDisplay().getRotation(), width, height);
        }
    }

    @Override
    public void onDrawFrame(GL10 gl) {
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT | GLES20.GL_DEPTH_BUFFER_BIT);
        if (session == null || !glReady || !sessionResumed) return;

        try {
            session.setCameraTextureName(background.getTextureId());
            Frame frame = session.update();
            background.draw(frame);

            Camera camera = frame.getCamera();
            boolean tracking = camera.getTrackingState() == TrackingState.TRACKING;

            if (tapPending) {
                tapPending = false;
                if (tracking) placeAnchorAtCentre(frame);
            }

            camera.getViewMatrix(viewMatrix, 0);
            camera.getProjectionMatrix(projMatrix, 0, 0.1f, 100f);
            Matrix.multiplyMM(viewProj, 0, projMatrix, 0, viewMatrix, 0);

            final List<MeasureOverlayView.ScreenPoint> pts = new ArrayList<>();
            for (Anchor a : anchors) {
                if (a.getTrackingState() != TrackingState.TRACKING) continue;
                MeasureOverlayView.ScreenPoint sp = project(a.getPose());
                if (sp != null) pts.add(sp);
            }

            String label = null;
            if (anchors.size() >= 2) {
                double m = distance(anchors.get(0).getPose(), anchors.get(1).getPose());
                lastMeters = m;
                label = formatLength(m);
            } else {
                lastMeters = -1;
            }

            final String finalLabel = label;
            final boolean finalTracking = tracking;
            runOnUiThread(() -> {
                overlay.setState(pts, finalLabel, finalTracking);
                if (!finalTracking) {
                    hint.setVisibility(View.VISIBLE);
                    hint.setText("Rör telefonen långsamt så AR-spårningen hittar rummet");
                } else if (anchors.isEmpty()) {
                    hint.setVisibility(View.VISIBLE);
                    hint.setText("Sikta med hårkorset och tryck för punkt A");
                    readout.setText("Tryck för punkt A");
                } else if (anchors.size() == 1) {
                    hint.setVisibility(View.VISIBLE);
                    hint.setText("Gå till punkt B och tryck igen");
                    readout.setText("Tryck för punkt B");
                } else {
                    hint.setVisibility(View.GONE);
                    readout.setText(finalLabel == null ? "" : finalLabel);
                }
                useBtn.setEnabled(lastMeters > 0);
                useBtn.setAlpha(lastMeters > 0 ? 1f : .45f);
                undoBtn.setEnabled(!anchors.isEmpty());
                undoBtn.setAlpha(anchors.isEmpty() ? .45f : 1f);
            });
        } catch (Throwable t) {
            // A dropped frame must never take the whole activity down.
        }
    }

    /**
     * Places a point where the centre reticle meets a real surface. Depth and
     * plane hits are preferred over raw feature points because they are far more
     * stable; a feature point is accepted only as a last resort so that bare,
     * untextured walls still work.
     */
    private void placeAnchorAtCentre(Frame frame) {
        float cx = surfaceView.getWidth() / 2f, cy = surfaceView.getHeight() / 2f;
        List<HitResult> hits = frame.hitTest(cx, cy);
        HitResult chosen = null, fallback = null;
        for (HitResult hit : hits) {
            com.google.ar.core.Trackable tr = hit.getTrackable();
            if (tr instanceof Plane && ((Plane) tr).isPoseInPolygon(hit.getHitPose())) {
                chosen = hit;
                break;
            }
            if (tr instanceof com.google.ar.core.DepthPoint && chosen == null) {
                chosen = hit;
            } else if (tr instanceof Point && fallback == null) {
                fallback = hit;
            }
        }
        if (chosen == null) chosen = fallback;
        if (chosen == null) {
            runOnUiThread(() -> Toast.makeText(this,
                    "Hittade ingen yta där – rör telefonen lite och försök igen",
                    Toast.LENGTH_SHORT).show());
            return;
        }
        if (anchors.size() >= 2) {
            for (Anchor a : anchors) a.detach();
            anchors.clear();
        }
        anchors.add(chosen.createAnchor());
    }

    private MeasureOverlayView.ScreenPoint project(Pose pose) {
        float[] world = new float[]{pose.tx(), pose.ty(), pose.tz(), 1f};
        float[] clip = new float[4];
        Matrix.multiplyMV(clip, 0, viewProj, 0, world, 0);
        if (clip[3] <= 0f) return null;
        float ndcX = clip[0] / clip[3], ndcY = clip[1] / clip[3];
        float sx = (ndcX + 1f) / 2f * surfaceView.getWidth();
        float sy = (1f - ndcY) / 2f * surfaceView.getHeight();
        return new MeasureOverlayView.ScreenPoint(sx, sy);
    }

    private static double distance(Pose a, Pose b) {
        double dx = a.tx() - b.tx(), dy = a.ty() - b.ty(), dz = a.tz() - b.tz();
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    private static String formatLength(double m) {
        if (m < 1.0) return String.format(java.util.Locale.forLanguageTag("sv-SE"), "%.0f mm", m * 1000);
        return String.format(java.util.Locale.forLanguageTag("sv-SE"), "%.2f m", m);
    }
}
