package app.locale.exercisetracker.store;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.zip.CRC32;

/**
 * Columnar track blob, byte-compatible with src/db/trackCodec.js.
 *
 * "LTRK" | u8 version | u8 fieldCount | u32 n | per field: u8 nameLen, name, u8 kind
 * (1=f64, 2=f32, 3=u16, 4=u8), u32 byteLength, padding to element size, data. Little-endian.
 */
public final class TrackCodec {
    public static final int FORMAT = 1;

    private TrackCodec() {}

    /** A decoded track: point count plus named columns (double[], float[], char[] for u16, byte[] for u8). */
    public static final class Track {
        public final int n;
        public final Map<String, Object> columns = new LinkedHashMap<>();

        public Track(int n) {
            this.n = n;
        }
    }

    public static long crc32(byte[] bytes) {
        CRC32 c = new CRC32();
        c.update(bytes, 0, bytes.length);
        return c.getValue();
    }

    private static int kindOf(Object column) {
        if (column instanceof double[]) return 1;
        if (column instanceof float[]) return 2;
        if (column instanceof char[]) return 3;
        if (column instanceof byte[]) return 4;
        throw new IllegalArgumentException("Unsupported column type " + column.getClass());
    }

    private static int elementSize(int kind) {
        switch (kind) {
            case 1:
                return 8;
            case 2:
                return 4;
            case 3:
                return 2;
            case 4:
                return 1;
            default:
                throw new IllegalArgumentException("Unknown column kind " + kind);
        }
    }

    private static int length(Object column) {
        if (column instanceof double[]) return ((double[]) column).length;
        if (column instanceof float[]) return ((float[]) column).length;
        if (column instanceof char[]) return ((char[]) column).length;
        return ((byte[]) column).length;
    }

    private static int pad(int position, int size) {
        return (size - (position % size)) % size;
    }

    public static byte[] pack(Track track) {
        int size = 10;
        for (Map.Entry<String, Object> e : track.columns.entrySet()) {
            int kind = kindOf(e.getValue());
            int es = elementSize(kind);
            size += 1 + e.getKey().length() + 1 + 4;
            size += pad(size, es);
            size += length(e.getValue()) * es;
        }
        ByteBuffer b = ByteBuffer.allocate(size).order(ByteOrder.LITTLE_ENDIAN);
        b.put(new byte[] { 'L', 'T', 'R', 'K' });
        b.put((byte) FORMAT);
        b.put((byte) track.columns.size());
        b.putInt(track.n);
        for (Map.Entry<String, Object> e : track.columns.entrySet()) {
            byte[] name = e.getKey().getBytes(StandardCharsets.US_ASCII);
            Object col = e.getValue();
            int kind = kindOf(col);
            int es = elementSize(kind);
            b.put((byte) name.length);
            b.put(name);
            b.put((byte) kind);
            b.putInt(length(col) * es);
            b.position(b.position() + pad(b.position(), es));
            switch (kind) {
                case 1:
                    for (double v : (double[]) col) b.putDouble(v);
                    break;
                case 2:
                    for (float v : (float[]) col) b.putFloat(v);
                    break;
                case 3:
                    for (char v : (char[]) col) b.putChar(v);
                    break;
                default:
                    b.put((byte[]) col);
            }
        }
        return b.array();
    }

    public static Track unpack(byte[] bytes) {
        ByteBuffer b = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
        if (bytes.length < 10 || bytes[0] != 'L' || bytes[1] != 'T' || bytes[2] != 'R' || bytes[3] != 'K') {
            throw new IllegalArgumentException("Not a Locale track blob");
        }
        b.position(4);
        int version = b.get() & 0xff;
        if (version != FORMAT) throw new IllegalArgumentException("Unsupported track format " + version);
        int count = b.get() & 0xff;
        Track t = new Track(b.getInt());
        for (int f = 0; f < count; f++) {
            byte[] name = new byte[b.get() & 0xff];
            b.get(name);
            int kind = b.get() & 0xff;
            int byteLength = b.getInt();
            int es = elementSize(kind);
            b.position(b.position() + pad(b.position(), es));
            int len = byteLength / es;
            Object col;
            switch (kind) {
                case 1: {
                    double[] a = new double[len];
                    for (int i = 0; i < len; i++) a[i] = b.getDouble();
                    col = a;
                    break;
                }
                case 2: {
                    float[] a = new float[len];
                    for (int i = 0; i < len; i++) a[i] = b.getFloat();
                    col = a;
                    break;
                }
                case 3: {
                    char[] a = new char[len];
                    for (int i = 0; i < len; i++) a[i] = b.getChar();
                    col = a;
                    break;
                }
                default: {
                    byte[] a = new byte[len];
                    b.get(a);
                    col = a;
                }
            }
            t.columns.put(new String(name, StandardCharsets.US_ASCII), col);
        }
        return t;
    }
}
