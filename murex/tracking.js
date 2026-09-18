(() => {
  const endpoint = window.MUREX_TRACKING_ENDPOINT;
  if (!endpoint || location.hostname === 'localhost' || location.hostname === '127.0.0.1') return;
  const storageKey = 'murex-pending-events-v1';
  let pending = [], busy = false;
  try { pending = JSON.parse(sessionStorage.getItem(storageKey) || '[]'); if (!Array.isArray(pending)) pending = []; } catch { pending = []; }
  const save = () => { try { sessionStorage.setItem(storageKey, JSON.stringify(pending)); } catch {} };
  const flush = async () => {
    if (busy || !navigator.onLine) return;
    busy = true;
    try {
      for (const event of [...pending]) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        try {
          const response = await fetch(endpoint, {method:'POST', headers:{'content-type':'text/plain'}, body:JSON.stringify(event), keepalive:true, credentials:'omit', signal:controller.signal});
          if (!response.ok) break;
          pending = pending.filter(item => !(item.id === event.id && item.type === event.type)); save();
        } finally { clearTimeout(timeout); }
      }
    } catch {} finally { busy = false; }
  };
  window.murexTrack = (id, type) => {
    if (!id || pending.some(e => e.id === id && e.type === type)) return;
    pending.push({id,type}); pending = pending.slice(-100); save(); void flush();
  };
  addEventListener('online', flush);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void flush(); });
  setInterval(flush,15000); void flush();
})();
