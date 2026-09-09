package se.caanel.field.ar;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.util.AttributeSet;
import android.view.View;

import java.util.ArrayList;
import java.util.List;

/**
 * All measurement UI is drawn here as ordinary 2D, on top of the GL camera
 * surface. World anchors are projected to screen coordinates by the renderer
 * each frame and handed over, so nothing 3D has to be rendered — this keeps the
 * look identical to the rest of EKIS FIELD instead of introducing a separate
 * 3D visual language.
 */
public class MeasureOverlayView extends View {

    public static class ScreenPoint {
        public final float x, y;
        public ScreenPoint(float x, float y) { this.x = x; this.y = y; }
    }

    private final Paint dotFill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint dotRing = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint line = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint labelBg = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint labelText = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint reticle = new Paint(Paint.ANTI_ALIAS_FLAG);

    private final List<ScreenPoint> points = new ArrayList<>();
    private String distanceLabel = null;
    private boolean tracking = false;
    private boolean lockOn = false;      // reticle has a stable surface under it
    private String previewLabel = null;  // live distance to that surface
    private int accent = Color.parseColor("#ff6a00");

    public MeasureOverlayView(Context c) { this(c, null); }

    public MeasureOverlayView(Context c, AttributeSet a) {
        super(c, a);
        setLayerType(LAYER_TYPE_HARDWARE, null);
        applyAccent(accent);
        line.setStyle(Paint.Style.STROKE);
        line.setStrokeWidth(dp(3.5f));
        line.setStrokeCap(Paint.Cap.ROUND);
        dotRing.setStyle(Paint.Style.STROKE);
        dotRing.setStrokeWidth(dp(2.5f));
        reticle.setStyle(Paint.Style.STROKE);
        reticle.setStrokeWidth(dp(1.6f));
        labelBg.setColor(Color.parseColor("#e6101012"));
        labelText.setColor(Color.WHITE);
        labelText.setTextSize(dp(17f));
        labelText.setFakeBoldText(true);
    }

    /** Light/dark chrome for the distance label, matching the app's theme. */
    public void applyChrome(boolean light) {
        labelBg.setColor(light ? Color.parseColor("#e6f2f3f5") : Color.parseColor("#e6101012"));
        labelText.setColor(light ? Color.parseColor("#14161a") : Color.WHITE);
        dotRing.setColor(light ? Color.parseColor("#14161a") : Color.WHITE);
        invalidate();
    }

    /** Keeps the AR view in step with the theme chosen in the web UI. */
    public void applyAccent(int color) {
        accent = color;
        dotFill.setColor(color);
        dotRing.setColor(Color.WHITE);
        line.setColor(color);
        reticle.setColor(Color.argb(190, Color.red(color), Color.green(color), Color.blue(color)));
        invalidate();
    }

    public void setState(List<ScreenPoint> pts, String label, boolean isTracking,
                         boolean isLockOn, String preview) {
        points.clear();
        if (pts != null) points.addAll(pts);
        distanceLabel = label;
        tracking = isTracking;
        lockOn = isLockOn;
        previewLabel = preview;
        invalidate();
    }

    private float dp(float v) { return v * getResources().getDisplayMetrics().density; }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        float cx = getWidth() / 2f, cy = getHeight() / 2f;

        // Centre reticle: shows where a tap will land, and dims while ARCore
        // still lacks tracking so the user knows to move the phone a little.
        // The reticle now reports whether a point can actually be trusted here:
        // dim = no tracking, thin ring = surface found but still settling,
        // solid ring with a filled centre = locked on and safe to tap.
        float r = dp(13f) * (lockOn ? 1f : 1.25f);
        reticle.setAlpha(!tracking ? 60 : (lockOn ? 255 : 130));
        reticle.setStrokeWidth(dp(lockOn ? 2.6f : 1.5f));
        canvas.drawCircle(cx, cy, r, reticle);
        canvas.drawLine(cx - r * 1.7f, cy, cx - r * 0.55f, cy, reticle);
        canvas.drawLine(cx + r * 0.55f, cy, cx + r * 1.7f, cy, reticle);
        canvas.drawLine(cx, cy - r * 1.7f, cx, cy - r * 0.55f, reticle);
        canvas.drawLine(cx, cy + r * 0.55f, cx, cy + r * 1.7f, reticle);
        if (lockOn) canvas.drawCircle(cx, cy, dp(3.2f), dotFill);
        if (previewLabel != null) {
            float tw = labelText.measureText(previewLabel);
            canvas.drawText(previewLabel, cx - tw / 2, cy + r * 2.6f + dp(14f), labelText);
        }

        if (points.size() >= 2) {
            ScreenPoint a = points.get(0), b = points.get(1);
            canvas.drawLine(a.x, a.y, b.x, b.y, line);
        }
        for (ScreenPoint p : points) {
            canvas.drawCircle(p.x, p.y, dp(8f), dotFill);
            canvas.drawCircle(p.x, p.y, dp(8f), dotRing);
        }

        if (distanceLabel != null && points.size() >= 2) {
            ScreenPoint a = points.get(0), b = points.get(1);
            float mx = (a.x + b.x) / 2f, my = (a.y + b.y) / 2f;
            float tw = labelText.measureText(distanceLabel);
            float padX = dp(14f), padY = dp(9f);
            RectF box = new RectF(mx - tw / 2 - padX, my - dp(20f) - padY,
                    mx + tw / 2 + padX, my - dp(20f) + dp(18f) + padY);
            canvas.drawRoundRect(box, dp(12f), dp(12f), labelBg);
            canvas.drawText(distanceLabel, mx - tw / 2, box.bottom - padY - dp(3f), labelText);
        }
    }
}
