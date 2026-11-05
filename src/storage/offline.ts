export interface OfflineStatus { state: 'unsupported' | 'idle' | 'preparing' | 'ready' | 'error'; done?: number; total?: number; bytes?: number; totalBytes?: number; message?: string; release?: string }
let registration: ServiceWorkerRegistration | undefined;
export async function offlineWorker(): Promise<ServiceWorkerRegistration> {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) throw new Error('Offline installation requires a production build served over HTTPS or localhost.');
  registration ??= await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL });
  await navigator.serviceWorker.ready;
  return registration;
}
export async function offlineAction(action: 'status' | 'prepare', update: (status: OfflineStatus) => void): Promise<void> {
  try {
    const reg = await offlineWorker();
    if (action === 'prepare') { await reg.update(); update({ state: 'preparing', done: 0, total: 0 }); }
    const target = reg.waiting ?? reg.installing ?? reg.active;
    if (!target) throw new Error('Service worker is not active.');
    const channel = new MessageChannel();
    channel.port1.onmessage = event => {
      const data = event.data;
      if (data.type === 'progress') update({ state: 'preparing', ...data });
      else if (data.type === 'ready') { update({ state: 'ready', release: data.release }); channel.port1.close(); }
      else if (data.type === 'missing') { update({ state: 'idle' }); channel.port1.close(); }
      else if (data.type === 'error') { update({ state: 'error', message: data.message }); channel.port1.close(); }
    };
    target.postMessage({ type: action }, [channel.port2]);
  } catch (error) { update({ state: import.meta.env.PROD ? 'error' : 'unsupported', message: String(error) }); }
}
