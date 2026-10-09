// Pack a columnar track (typed arrays) into one binary blob for SQLite, and back.
// Mirrored in TrackCodec.java; keep the two in sync.
//
// Layout (little-endian):
//   "LTRK"                       magic (4 bytes)
//   u8  version (=1)
//   u8  field count
//   u32 n (points)
//   per field:
//     u8  name length, then ASCII name
//     u8  kind (1=f64, 2=f32, 3=u16, 4=u8)
//     u32 byte length
//     0–7 zero bytes padding so the data starts at a multiple of its element size
//     data

export const TRACK_FORMAT = 1;

const KINDS = [
  [1, Float64Array],
  [2, Float32Array],
  [3, Uint16Array],
  [4, Uint8Array],
];
const kindOf = (arr) => KINDS.find(([, C]) => arr instanceof C)?.[0];
const ctorOf = (kind) => KINDS.find(([k]) => k === kind)?.[1];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** Standard CRC-32 (IEEE 802.3), same as java.util.zip.CRC32. */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** @returns {Uint8Array} */
export function packTrack(track) {
  const fields = Object.entries(track).filter(([, v]) => ArrayBuffer.isView(v) && kindOf(v));
  let size = 4 + 1 + 1 + 4;
  for (const [name, arr] of fields) {
    size += 1 + name.length + 1 + 4;
    size += (arr.BYTES_PER_ELEMENT - (size % arr.BYTES_PER_ELEMENT)) % arr.BYTES_PER_ELEMENT;
    size += arr.byteLength;
  }
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out.set([0x4c, 0x54, 0x52, 0x4b], 0); // LTRK
  view.setUint8(4, TRACK_FORMAT);
  view.setUint8(5, fields.length);
  view.setUint32(6, track.n, true);
  let p = 10;
  for (const [name, arr] of fields) {
    view.setUint8(p++, name.length);
    for (let i = 0; i < name.length; i++) out[p++] = name.charCodeAt(i);
    view.setUint8(p++, kindOf(arr));
    view.setUint32(p, arr.byteLength, true);
    p += 4;
    p += (arr.BYTES_PER_ELEMENT - (p % arr.BYTES_PER_ELEMENT)) % arr.BYTES_PER_ELEMENT;
    // Copy bytes in little-endian order regardless of platform.
    const dst = new DataView(out.buffer, p, arr.byteLength);
    const bpe = arr.BYTES_PER_ELEMENT;
    for (let i = 0; i < arr.length; i++) {
      const o = i * bpe;
      if (arr instanceof Float64Array) dst.setFloat64(o, arr[i], true);
      else if (arr instanceof Float32Array) dst.setFloat32(o, arr[i], true);
      else if (arr instanceof Uint16Array) dst.setUint16(o, arr[i], true);
      else dst.setUint8(o, arr[i]);
    }
    p += arr.byteLength;
  }
  return out;
}

/** @returns {object} track with typed arrays and n */
export function unpackTrack(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] !== 0x4c || bytes[1] !== 0x54 || bytes[2] !== 0x52 || bytes[3] !== 0x4b) throw new Error('Not a Locale track blob');
  const version = view.getUint8(4);
  if (version !== TRACK_FORMAT) throw new Error(`Unsupported track format ${version}`);
  const count = view.getUint8(5);
  const track = { n: view.getUint32(6, true) };
  let p = 10;
  for (let f = 0; f < count; f++) {
    const len = view.getUint8(p++);
    let name = '';
    for (let i = 0; i < len; i++) name += String.fromCharCode(bytes[p++]);
    const kind = view.getUint8(p++);
    const byteLength = view.getUint32(p, true);
    p += 4;
    const C = ctorOf(kind);
    if (!C) throw new Error(`Unknown column kind ${kind}`);
    p += (C.BYTES_PER_ELEMENT - (p % C.BYTES_PER_ELEMENT)) % C.BYTES_PER_ELEMENT;
    const arr = new C(byteLength / C.BYTES_PER_ELEMENT);
    for (let i = 0; i < arr.length; i++) {
      const o = p + i * C.BYTES_PER_ELEMENT;
      if (kind === 1) arr[i] = view.getFloat64(o, true);
      else if (kind === 2) arr[i] = view.getFloat32(o, true);
      else if (kind === 3) arr[i] = view.getUint16(o, true);
      else arr[i] = view.getUint8(o);
    }
    track[name] = arr;
    p += byteLength;
  }
  return track;
}

/** Base64 helpers for the Capacitor bridge. */
export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
