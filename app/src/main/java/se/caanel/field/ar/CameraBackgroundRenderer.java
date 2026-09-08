package se.caanel.field.ar;

import android.content.Context;
import android.opengl.GLES11Ext;
import android.opengl.GLES20;

import com.google.ar.core.Coordinates2d;
import com.google.ar.core.Frame;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;

/**
 * Draws the ARCore camera stream as a full-screen quad.
 *
 * ARCore hands the camera image over as an OpenGL external texture, so it can
 * never be drawn with an ordinary View — it needs a GL surface and a shader
 * that samples samplerExternalOES. Everything the user actually interacts with
 * (points, lines, labels) is drawn in a normal Android View on top of this, so
 * only the raw camera feed lives down here.
 */
public class CameraBackgroundRenderer {

    private static final float[] QUAD_COORDS = new float[]{
            -1f, -1f, +1f, -1f, -1f, +1f, +1f, +1f
    };

    private int program;
    private int positionAttrib;
    private int texCoordAttrib;
    private int textureUniform;
    private int textureId = -1;

    private FloatBuffer quadCoords;
    private FloatBuffer quadTexCoords;

    public int getTextureId() {
        return textureId;
    }

    public void createOnGlThread(Context context) {
        int[] textures = new int[1];
        GLES20.glGenTextures(1, textures, 0);
        textureId = textures[0];
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR);

        ByteBuffer bb = ByteBuffer.allocateDirect(QUAD_COORDS.length * 4);
        bb.order(ByteOrder.nativeOrder());
        quadCoords = bb.asFloatBuffer();
        quadCoords.put(QUAD_COORDS);
        quadCoords.position(0);

        ByteBuffer bbTex = ByteBuffer.allocateDirect(QUAD_COORDS.length * 4);
        bbTex.order(ByteOrder.nativeOrder());
        quadTexCoords = bbTex.asFloatBuffer();

        int vertexShader = loadShader(context, GLES20.GL_VERTEX_SHADER, "shaders/camera.vert");
        int fragmentShader = loadShader(context, GLES20.GL_FRAGMENT_SHADER, "shaders/camera.frag");

        program = GLES20.glCreateProgram();
        GLES20.glAttachShader(program, vertexShader);
        GLES20.glAttachShader(program, fragmentShader);
        GLES20.glLinkProgram(program);
        GLES20.glUseProgram(program);

        positionAttrib = GLES20.glGetAttribLocation(program, "a_Position");
        texCoordAttrib = GLES20.glGetAttribLocation(program, "a_TexCoord");
        textureUniform = GLES20.glGetUniformLocation(program, "u_Texture");
    }

    /**
     * ARCore decides how the camera image maps onto the screen (it changes with
     * device rotation and aspect ratio), so the texture coordinates are asked
     * for rather than assumed — otherwise the preview is stretched or rotated
     * on some devices.
     */
    public void draw(Frame frame) {
        if (frame == null || textureId == -1) return;

        if (frame.hasDisplayGeometryChanged()) {
            quadCoords.position(0);
            quadTexCoords.position(0);
            frame.transformCoordinates2d(
                    Coordinates2d.OPENGL_NORMALIZED_DEVICE_COORDINATES, quadCoords,
                    Coordinates2d.TEXTURE_NORMALIZED, quadTexCoords);
        }

        GLES20.glDisable(GLES20.GL_DEPTH_TEST);
        GLES20.glDepthMask(false);
        GLES20.glUseProgram(program);

        GLES20.glActiveTexture(GLES20.GL_TEXTURE0);
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId);
        GLES20.glUniform1i(textureUniform, 0);

        quadCoords.position(0);
        GLES20.glVertexAttribPointer(positionAttrib, 2, GLES20.GL_FLOAT, false, 0, quadCoords);
        quadTexCoords.position(0);
        GLES20.glVertexAttribPointer(texCoordAttrib, 2, GLES20.GL_FLOAT, false, 0, quadTexCoords);

        GLES20.glEnableVertexAttribArray(positionAttrib);
        GLES20.glEnableVertexAttribArray(texCoordAttrib);
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4);
        GLES20.glDisableVertexAttribArray(positionAttrib);
        GLES20.glDisableVertexAttribArray(texCoordAttrib);

        GLES20.glDepthMask(true);
        GLES20.glEnable(GLES20.GL_DEPTH_TEST);
    }

    private static int loadShader(Context context, int type, String assetPath) {
        StringBuilder sb = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(context.getAssets().open(assetPath)))) {
            String line;
            while ((line = reader.readLine()) != null) sb.append(line).append('\n');
        } catch (Exception e) {
            throw new RuntimeException("Kunde inte läsa shader: " + assetPath, e);
        }
        int shader = GLES20.glCreateShader(type);
        GLES20.glShaderSource(shader, sb.toString());
        GLES20.glCompileShader(shader);
        int[] status = new int[1];
        GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, status, 0);
        if (status[0] == 0) {
            String log = GLES20.glGetShaderInfoLog(shader);
            GLES20.glDeleteShader(shader);
            throw new RuntimeException("Shaderfel i " + assetPath + ": " + log);
        }
        return shader;
    }
}
