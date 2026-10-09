// Write an export to the cache directory and hand it to the Android share sheet.

import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

/** Base64 for binary content (Capacitor's Filesystem takes base64 when no encoding is given). */
function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Share a text (string) or binary (Uint8Array) export. */
export async function shareFile({ filename, content, mime, title }) {
  const binary = content instanceof Uint8Array;
  if (!Capacitor.isNativePlatform()) {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return;
  }
  const { uri } = await Filesystem.writeFile({
    path: `exports/${filename}`,
    data: binary ? toBase64(content) : content,
    directory: Directory.Cache,
    ...(binary ? {} : { encoding: Encoding.UTF8 }),
    recursive: true,
  });
  try {
    await Share.share({ title, files: [uri], dialogTitle: 'Export workout' });
  } catch (e) {
    // Dismissing the share sheet rejects with "Share canceled"; that is not an error.
    if (!/cancel/i.test(String(e?.message ?? e))) throw e;
  }
}
