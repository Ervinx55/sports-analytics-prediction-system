export function readHealthSnapshot(snapshot, now = Date.now()) {
  const observed = typeof snapshot?.observed_at === 'string' ? Date.parse(snapshot.observed_at) : NaN;
  const age = now - observed;
  if (!Number.isFinite(age) || age < 0 || age > 120000 || !Array.isArray(snapshot?.data)) {
    const error = new Error('Pipeline health snapshot unavailable or stale; live health is unverified.');
    error.name = 'HealthSnapshotUnavailable';
    throw error;
  }
  return { rows: snapshot.data, observedAt: snapshot.observed_at, ageSeconds: Math.floor(age / 1000) };
}
