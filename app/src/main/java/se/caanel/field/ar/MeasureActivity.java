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
    // Smoothing + UI throttling state. The readout is recomputed every GL frame,
    // and every frame used to push text, visibility and enabled-state into the
    // views — 60 UI updates a second, which is what made the whole panel flicker.
    private final java.util.ArrayDeque<Double> samples = new java.util.ArrayDeque<>();
    private double smoothed = -1;
    private long lastUiPush = 0;
    private long hintHoldUntil = 0;
    private String lastHintShown = "", lastReadoutShown = "";
    // Diagnostics. Four attempts at fixing the wild readings have been made from
    // reasoning alone, without being able to run the code — so instead of a
    // fifth guess, the numbers ARCore is actually working with are put on screen.
    private TextView diag;
    private boolean diagOn = false;
    private volatile String lastHitInfo = "–";
    private volatile String lastRejectInfo = "–";
    // Live preview at the reticle. Until now a point could only be judged AFTER
    // it was placed, so a bad depth reading became a bad measurement. The hit is
    // now evaluated every frame and only accepted once it has held still for a
    // moment — which is exactly the condition a trustworthy point needs.
    private final java.util.ArrayDeque<Float> previewDepths = new java.util.ArrayDeque<>();
    private volatile float previewDist = -1;
    private volatile boolean previewStable = false;
    private boolean trackingLostSincePointA = false;

    // Display geometry has to reach ARCore before any hit test is meaningful:
    // hitTest() interprets its x/y in the geometry ARCore was last told about.
    // It used to be set only from onSurfaceChanged, which runs on the GL thread
    // and can fire while `session` is still null (first launch, when ARCore is
    // being installed). Then it was never set again — ARCore kept its default
    // geometry, every tap hit-tested the wrong part of the scene, and the
    // resulting points landed at essentially arbitrary depth. That is a very
    // good candidate for the wild readings. Now the values are remembered and
    // re-applied whenever they change or the session appears.
    private int viewW = 0, viewH = 0, viewRot = -1;
    private boolean geometryApplied = false;
    private boolean depthSupported = false;

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
            chromeBg = Color.parseColor("#eef1f6");
            chromeBgSoft = Color.parseColor("#e8eaee");
            chromeText = Color.parseColor("#14161a");
            chromeBtn = Color.parseColor("#dfe2e7");
            chromeBtnText = Color.parseColor("#14161a");
        } else if ("jul".equalsIgnoreCase(getIntent().getStringExtra(EXTRA_THEME))) {
            chromeBg = Color.parseColor("#08130e");
            chromeBgSoft = Color.parseColor("#122019");
            chromeText = Color.parseColor("#f6f0e4");
            chromeBtn = Color.parseColor("#193026");
            chromeBtnText = Color.parseColor("#f6f0e4");
        } else if ("sky".equalsIgnoreCase(getIntent().getStringExtra(EXTRA_THEME))) {
            chromeBg = Color.parseColor("#03101f");
            chromeBgSoft = Color.parseColor("#0a2242");
            chromeText = Color.parseColor("#f0f9ff");
            chromeBtn = Color.parseColor("#0f3157");
            chromeBtnText = Color.parseColor("#f0f9ff");
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
        hp.setMargins((int) (14 * d), (int) (52 * d), (int) (14 * d), 0);
        root.addView(hint, hp);

        diag = new TextView(this);
        diag.setTextColor(Color.parseColor("#b8ffd9"));
        diag.setTextSize(11f);
        diag.setTypeface(android.graphics.Typeface.MONOSPACE);
        diag.setBackgroundColor(Color.parseColor("#cc000000"));
        diag.setPadding((int) (10 * d), (int) (8 * d), (int) (10 * d), (int) (8 * d));
        diag.setVisibility(View.GONE);
        FrameLayout.LayoutParams dp2 = new FrameLayout.LayoutParams(-1, -2);
        dp2.gravity = Gravity.TOP;
        dp2.setMargins((int) (10 * d), (int) (110 * d), (int) (10 * d), 0);
        root.addView(diag, dp2);

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.VERTICAL);
        bar.setGravity(Gravity.CENTER_HORIZONTAL);
        bar.setPadding((int) (18 * d), (int) (16 * d), (int) (18 * d), (int) (28 * d));
        bar.setOnApplyWindowInsetsListener((v, insets) -> {
            int bottom = insets.getSystemWindowInsetBottom();
            v.setPadding(v.getPaddingLeft(), v.getPaddingTop(), v.getPaddingRight(),
                    (int) (16 * d) + bottom);
            return insets;
        });
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
                smoothed = -1;
                samples.clear();
            }
        });
        row.addView(undoBtn, buttonParams(d));

        Button diagBtn = styledButton("Diag", false, d);
        diagBtn.setOnClickListener(v -> {
            diagOn = !diagOn;
            diag.setVisibility(diagOn ? View.VISIBLE : View.GONE);
        });
        row.addView(diagBtn, buttonParams(d));

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
                depthSupported = session.isDepthModeSupported(Config.DepthMode.AUTOMATIC);
                if (depthSupported) {
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
        viewW = width;
        viewH = height;
        viewRot = getWindowManager().getDefaultDisplay().getRotation();
        geometryApplied = false;
    }

    @Override
    public void onDrawFrame(GL10 gl) {
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT | GLES20.GL_DEPTH_BUFFER_BIT);
        if (session == null || !glReady || !sessionResumed) return;

        try {
            if (!geometryApplied && viewW > 0 && viewH > 0) {
                session.setDisplayGeometry(viewRot, viewW, viewH);
                geometryApplied = true;
            }
            session.setCameraTextureName(background.getTextureId());
            Frame frame = session.update();
            background.draw(frame);

            Camera camera = frame.getCamera();
            boolean tracking = camera.getTrackingState() == TrackingState.TRACKING;

            updatePreview(frame, tracking);
            if (!tracking && !anchors.isEmpty()) trackingLostSincePointA = true;

            if (tapPending) {
                tapPending = false;
                if (!tracking) {
                    showHint("Vänta – AR-spårningen har inte låst på rummet än");
                } else if (!previewStable) {
                    showHint("Avläsningen är ostadig där – håll stilla en sekund tills hårkorset blir fast");
                } else {
                    placeAnchorAtCentre(frame);
                }
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
            if (anchors.size() >= 2
                    && anchors.get(0).getTrackingState() == TrackingState.TRACKING
                    && anchors.get(1).getTrackingState() == TrackingState.TRACKING) {
                double m = distance(anchors.get(0).getPose(), anchors.get(1).getPose());
                // A rolling median over the last samples. ARCore keeps refining
                // anchor poses, so the raw number twitches by centimetres every
                // frame; the median also throws away the odd wild outlier
                // instead of letting it flash up on screen.
                samples.addLast(m);
                while (samples.size() > 12) samples.removeFirst();
                Double[] arr = samples.toArray(new Double[0]);
                java.util.Arrays.sort(arr);
                smoothed = arr[arr.length / 2];
                lastMeters = smoothed;
                label = formatLength(smoothed);
            } else if (anchors.size() < 2) {
                lastMeters = -1;
                smoothed = -1;
                samples.clear();
            }

            // The overlay follows the camera and must stay at frame rate, but the
            // text panel only needs a few updates a second — and only when the
            // text actually changed.
            final String finalLabel = label;
            final boolean finalTracking = tracking;
            final boolean lock = previewStable;
            final String prev = (anchors.size() < 2 && previewDist > 0)
                    ? formatLength(previewDist) : null;
            runOnUiThread(() -> overlay.setState(pts, finalLabel, finalTracking, lock, prev));

            long now = System.currentTimeMillis();
            if (now - lastUiPush < 120) return;
            lastUiPush = now;

            final String hintText;
            final String readoutText;
            if (!finalTracking) {
                // Naming the actual reason matters: ARCore degrades badly in dim
                // light, and every measurement taken while tracking is poor is
                // unreliable no matter what the code does afterwards.
                switch (camera.getTrackingFailureReason()) {
                    case INSUFFICIENT_LIGHT:
                        hintText = "För mörkt för AR – tänd ljuset i rummet"; break;
                    case EXCESSIVE_MOTION:
                        hintText = "Du rör telefonen för fort – håll den stilla"; break;
                    case INSUFFICIENT_FEATURES:
                        hintText = "För kal yta – rikta mot något med mönster eller kanter"; break;
                    case CAMERA_UNAVAILABLE:
                        hintText = "Kameran är upptagen av en annan app"; break;
                    default:
                        hintText = "Rör telefonen långsamt så AR-spårningen hittar rummet";
                }
                readoutText = anchors.isEmpty() ? "Tryck för punkt A" : lastReadoutShown;
            } else if (anchors.isEmpty()) {
                hintText = "Sikta med hårkorset och tryck för punkt A";
                readoutText = "Tryck för punkt A";
            } else if (anchors.size() == 1) {
                hintText = "Punkt A satt – sikta på punkt B och tryck igen";
                readoutText = "Tryck för punkt B";
            } else {
                // Anchors placed either side of a tracking dropout can sit in
                // effectively different frames of reference, so the span between
                // them is not trustworthy — say so rather than present a number.
                hintText = trackingLostSincePointA
                        ? "Spårningen tappades mellan punkterna – mät om för säkert värde" : null;
                readoutText = finalLabel == null ? "" : finalLabel;
            }

            // Diagnostics text is assembled here where the frame data is available.
            String diagText = null;
            if (diagOn) {
                StringBuilder sb = new StringBuilder();
                sb.append("spårning: ").append(camera.getTrackingState());
                if (camera.getTrackingState() != TrackingState.TRACKING) {
                    sb.append(" (").append(camera.getTrackingFailureReason()).append(")");
                }
                int planes = 0, tracked = 0;
                for (Plane pl : session.getAllTrackables(Plane.class)) {
                    planes++;
                    if (pl.getTrackingState() == TrackingState.TRACKING) tracked++;
                }
                sb.append("\nplan: ").append(tracked).append("/").append(planes);
                sb.append("  djup: ").append(depthSupported ? "ja" : "nej");
                sb.append("\ngeometri: ").append(viewW).append("x").append(viewH)
                  .append(" rot=").append(viewRot).append(" satt=").append(geometryApplied);
                sb.append("\nyta: ").append(surfaceView.getWidth()).append("x").append(surfaceView.getHeight());
                sb.append("\nförhandsvisning: ")
                  .append(previewDist > 0 ? String.format(java.util.Locale.US, "%.2fm", previewDist) : "ingen")
                  .append(previewStable ? " STABIL" : " ostadig")
                  .append(" n=").append(previewDepths.size());
                sb.append("\nsenaste träff: ").append(lastHitInfo);
                sb.append("\nsenast avvisad: ").append(lastRejectInfo);
                for (int i = 0; i < anchors.size(); i++) {
                    Anchor a = anchors.get(i);
                    Pose ap = a.getPose();
                    float dx = ap.tx() - camera.getPose().tx();
                    float dy = ap.ty() - camera.getPose().ty();
                    float dz = ap.tz() - camera.getPose().tz();
                    sb.append("\n").append(i == 0 ? "A" : "B").append(": ")
                      .append(a.getTrackingState())
                      .append(" kam=").append(String.format(java.util.Locale.US, "%.2f", Math.sqrt(dx*dx+dy*dy+dz*dz))).append("m")
                      .append(" xyz=").append(String.format(java.util.Locale.US, "%.2f,%.2f,%.2f", ap.tx(), ap.ty(), ap.tz()));
                }
                if (anchors.size() >= 2) {
                    sb.append("\nrå: ").append(String.format(java.util.Locale.US, "%.3f", distance(anchors.get(0).getPose(), anchors.get(1).getPose())))
                      .append("m  median: ").append(String.format(java.util.Locale.US, "%.3f", smoothed)).append("m")
                      .append("  n=").append(samples.size());
                }
                diagText = sb.toString();
            }
            final String finalDiag = diagText;

            runOnUiThread(() -> {
                if (finalDiag != null) diag.setText(finalDiag);
                if (System.currentTimeMillis() > hintHoldUntil) {
                    if (hintText == null) {
                        if (hint.getVisibility() != View.GONE) hint.setVisibility(View.GONE);
                    } else {
                        if (hint.getVisibility() != View.VISIBLE) hint.setVisibility(View.VISIBLE);
                        if (!hintText.equals(lastHintShown)) { hint.setText(hintText); lastHintShown = hintText; }
                    }
                }
                if (!readoutText.equals(lastReadoutShown)) { readout.setText(readoutText); lastReadoutShown = readoutText; }
                boolean canUse = lastMeters > 0;
                if (useBtn.isEnabled() != canUse) { useBtn.setEnabled(canUse); useBtn.setAlpha(canUse ? 1f : .45f); }
                boolean canUndo = !anchors.isEmpty();
                if (undoBtn.isEnabled() != canUndo) { undoBtn.setEnabled(canUndo); undoBtn.setAlpha(canUndo ? 1f : .45f); }
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

        // Raw feature points ("Point") used to be accepted as a last resort. They
        // are the single biggest source of nonsense readings: a feature point can
        // sit at almost any depth, which is how a kitchen wall came out as 24 m.
        // Only surfaces ARCore is actually confident about are accepted now —
        // a fitted plane, or a depth-map point where the phone supports depth.
        HitResult chosen = null;
        for (HitResult hit : hits) {
            com.google.ar.core.Trackable tr = hit.getTrackable();
            if (tr instanceof Plane
                    && ((Plane) tr).isPoseInPolygon(hit.getHitPose())
                    && tr.getTrackingState() == TrackingState.TRACKING) {
                chosen = hit;
                break;
            }
            if (chosen == null && tr instanceof com.google.ar.core.DepthPoint
                    && tr.getTrackingState() == TrackingState.TRACKING) {
                chosen = hit;
            }
        }
        if (chosen == null) {
            lastRejectInfo = "ingen godkänd träff (" + hits.size() + " raw)";
            showHint("Ingen säker yta där – rikta mot en vägg eller ett golv och rör telefonen lite");
            return;
        }

        // Anything far away is a tracking artefact rather than something being
        // measured indoors, and a point behind the camera is meaningless.
        float dist = chosen.getDistance();
        lastHitInfo = chosen.getTrackable().getClass().getSimpleName()
                + " d=" + String.format(java.util.Locale.US, "%.2f", dist) + "m"
                + " raw=" + hits.size();
        if (dist <= 0.05f || dist > 12f) {
            lastRejectInfo = "avstånd " + String.format(java.util.Locale.US, "%.2f", dist) + "m utanför 0.05–12";
            showHint("För osäkert avstånd där (" + String.format(java.util.Locale.forLanguageTag("sv-SE"), "%.1f m", dist) + ") – gå närmare");
            return;
        }

        if (anchors.size() >= 2) {
            for (Anchor a : anchors) a.detach();
            anchors.clear();
            smoothed = -1;
            samples.clear();
            trackingLostSincePointA = false;
        }
        // Anchoring on the trackable itself keeps the point locked to that
        // surface as ARCore refines it, instead of drifting with the session.
        com.google.ar.core.Trackable tr = chosen.getTrackable();
        Anchor placed = (tr != null) ? tr.createAnchor(chosen.getHitPose()) : chosen.createAnchor();

        // Sanity-check the SPAN, not just how far the point is from the camera.
        // Capping camera distance alone still allowed an A–B of tens of metres
        // when one point had landed badly — which is what a 38 m reading across
        // a kitchen table means. Nothing measured indoors spans that far, so the
        // point is rejected with an explanation rather than silently accepted.
        if (anchors.size() == 1) {
            double span = distance(anchors.get(0).getPose(), placed.getPose());
            if (span > 15.0) {
                lastRejectInfo = "span " + String.format(java.util.Locale.US, "%.2f", span) + "m > 15";
                placed.detach();
                showHint("Orimligt avstånd (" + formatLength(span) + ") – punkten togs inte. Rikta mot en tydlig yta och försök igen.");
                return;
            }
        }
        anchors.add(placed);
    }

    /**
     * Evaluates the surface under the reticle every frame and decides whether it
     * is trustworthy. A depth reading that jumps around between frames is the
     * signature of a bad hit, so a point is only allowed once the reading has
     * held within a couple of centimetres over several consecutive frames.
     */
    private void updatePreview(Frame frame, boolean tracking) {
        if (!tracking) { previewDepths.clear(); previewDist = -1; previewStable = false; return; }
        float cx = surfaceView.getWidth() / 2f, cy = surfaceView.getHeight() / 2f;
        Float d = null;
        for (HitResult hit : frame.hitTest(cx, cy)) {
            com.google.ar.core.Trackable tr = hit.getTrackable();
            if (tr.getTrackingState() != TrackingState.TRACKING) continue;
            if (tr instanceof Plane && ((Plane) tr).isPoseInPolygon(hit.getHitPose())) { d = hit.getDistance(); break; }
            if (d == null && tr instanceof com.google.ar.core.DepthPoint) d = hit.getDistance();
        }
        if (d == null || d <= 0.05f || d > 12f) {
            previewDepths.clear(); previewDist = -1; previewStable = false; return;
        }
        previewDepths.addLast(d);
        while (previewDepths.size() > 8) previewDepths.removeFirst();
        previewDist = d;
        if (previewDepths.size() < 6) { previewStable = false; return; }
        float min = Float.MAX_VALUE, max = -Float.MAX_VALUE;
        for (float v : previewDepths) { min = Math.min(min, v); max = Math.max(max, v); }
        // 2 cm of spread over the window, scaled a little with distance since
        // depth noise naturally grows further away.
        previewStable = (max - min) < Math.max(0.02f, previewDist * 0.02f);
    }

    private void showHint(String msg) {
        runOnUiThread(() -> { hint.setVisibility(View.VISIBLE); hint.setText(msg); });
        hintHoldUntil = System.currentTimeMillis() + 2500;
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
