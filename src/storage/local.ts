const DB = 'cdda-workshop-v1';
export async function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('local'); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function loadLocal<T>(key: string): Promise<T | undefined> {
  const db = await openStore();
  try { return await new Promise((resolve, reject) => { const r = db.transaction('local').objectStore('local').get(key); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
  finally { db.close(); }
}
export async function saveLocal(key: string, value: unknown): Promise<void> {
  const db = await openStore();
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('local', 'readwrite'); tx.objectStore('local').put(value, key); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); }); }
  finally { db.close(); }
}
export function safeFilename(input: string): string {
  const sanitized = input.normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '');
  const extension = sanitized.match(/\.[a-z0-9]{1,12}$/i)?.[0] ?? '';
  const clean = sanitized.length > 96 ? sanitized.slice(0, 96 - extension.length) + extension : sanitized;
  return !clean || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean) ? `export_${clean}` : clean;
}
export function download(name: string, content: string | Uint8Array, type = 'application/json'): void {
  const bytes = typeof content === 'string' ? content : new Uint8Array(content);
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a'); a.href = url; a.download = safeFilename(name); a.click();
  setTimeout(() => URL.revokeObjectURL(url), 20_000);
}
