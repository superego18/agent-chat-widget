import { createHash } from 'node:crypto';

// Retain only bounded ID/hash manifests, never additional transcript bodies.
export function createPollDeltas() {
  const snapshots = new Map();
  let bytes = 0;
  return (scope, data, field, version, known) => {
    const rows = data[field];
    if (!Array.isArray(rows) || rows.length > 50000) return null;
    const hashes = new Map();
    for (const row of rows) {
      if (!row || !['string', 'number'].includes(typeof row.id)) return null;
      const id = JSON.stringify(row.id);
      if (hashes.has(id)) return null;
      hashes.set(id, createHash('sha256').update(JSON.stringify(row)).digest('hex'));
    }
    const key = scope + ':' + version, previous = snapshots.get(scope + ':' + known);
    if (!snapshots.has(key)) {
      const size = Buffer.byteLength(JSON.stringify([...hashes]));
      if (size <= 4 * 1024 * 1024) { snapshots.set(key, { hashes, size }); bytes += size; }
      while (snapshots.size > 16 || bytes > 4 * 1024 * 1024) {
        const first = snapshots.keys().next().value; bytes -= snapshots.get(first).size; snapshots.delete(first);
      }
    }
    if (!previous) return null;
    const { [field]: ignored, ...metadata } = data;
    return { ...metadata, version, baseVersion: known, delta: true,
      [field]: rows.filter(row => previous.hashes.get(JSON.stringify(row.id)) !== hashes.get(JSON.stringify(row.id))),
      order: rows.map(row => row.id) };
  };
}
