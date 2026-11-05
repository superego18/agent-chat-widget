// Availability is an observation, never permission to resend a queued input.
export function createCodexControlReader({ read, now = Date.now, ttlMs = 30000 }) {
  let observedAt = null, loaded = null, pending, stopped = false;
  const refresh = () => {
    if (stopped || pending || (observedAt !== null && now() - observedAt < ttlMs)) return;
    pending = Promise.resolve().then(read).then(ids => { loaded = new Set(ids); }, () => { loaded = null; })
      .finally(() => { observedAt = now(); pending = null; });
  };
  return {
    snapshot(id) {
      refresh();
      const fresh = !stopped && observedAt !== null && now() - observedAt < ttlMs;
      const available = fresh && !!loaded?.has(id);
      return { available, state: stopped ? 'disconnected' : !fresh ? 'checking' : !loaded ? 'disconnected' : available ? 'connected' : 'not_loaded' };
    },
    settled() { return pending || Promise.resolve(); },
    shutdown() { stopped = true; return pending || Promise.resolve(); },
  };
}
