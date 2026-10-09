import { describe, expect, it } from 'vitest';
import { crc32, fromBase64, packTrack, toBase64, unpackTrack } from '../src/db/trackCodec.js';
import { processJournal } from '../src/geo/process.js';
import { parseJournal } from '../src/tracker/journal.js';
import { generateJournal } from '../src/tracker/synthetic.js';

describe('CRC-32', () => {
  it('matches the standard check value', () => {
    // CRC-32/ISO-HDLC of "123456789" is 0xCBF43926 (java.util.zip.CRC32 gives the same).
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe('track codec', () => {
  for (const heartRate of [false, true]) {
    it(`round-trips every column exactly (heart rate: ${heartRate})`, () => {
      const { track } = processJournal(parseJournal(generateJournal({ seconds: 900, pauses: [[400, 60]], heartRate }).text));
      const blob = packTrack(track);
      expect(String.fromCharCode(...blob.subarray(0, 4))).toBe('LTRK');
      const back = unpackTrack(blob);
      expect(back.n).toBe(track.n);
      const cols = Object.keys(track).filter((k) => ArrayBuffer.isView(track[k]));
      expect(Object.keys(back).filter((k) => k !== 'n').sort()).toEqual(cols.sort());
      for (const k of cols) {
        expect(back[k].constructor).toBe(track[k].constructor);
        // Byte-exact, including NaN payloads.
        expect(new Uint8Array(back[k].buffer)).toEqual(new Uint8Array(track[k].buffer));
      }
      expect('hr' in back).toBe(heartRate);
    });
  }

  it('survives base64 transport', () => {
    const { track } = processJournal(parseJournal(generateJournal({ seconds: 120 }).text));
    const blob = packTrack(track);
    const again = fromBase64(toBase64(blob));
    expect(crc32(again)).toBe(crc32(blob));
  });

  it('aligns each column to its element size', () => {
    const blob = packTrack({ n: 2, a: Uint8Array.of(1, 2), b: Float64Array.of(1.5, -2.25), c: Uint16Array.of(7, 9) });
    const back = unpackTrack(blob);
    expect(Array.from(back.b)).toEqual([1.5, -2.25]);
    expect(Array.from(back.c)).toEqual([7, 9]);
  });

  it('rejects foreign blobs', () => {
    expect(() => unpackTrack(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))).toThrow(/Not a Locale track/);
  });
});
