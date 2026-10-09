// Write an export to the cache directory and hand it to the Android share sheet.

import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export async function shareTextFile({ filename, content, mime, title }) {
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
    data: content,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
    recursive: true,
  });
  try {
    await Share.share({ title, files: [uri], dialogTitle: 'Export workout' });
  } catch (e) {
    // Dismissing the share sheet rejects with "Share canceled"; that is not an error.
    if (!/cancel/i.test(String(e?.message ?? e))) throw e;
  }
}
