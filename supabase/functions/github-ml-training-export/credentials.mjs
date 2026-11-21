// Keep credentials inside this server function. The project's modern-key gateway
// currently rejects its minted JWT (PGRST303); the existing service-role JWT is
// still supported and is used by the other internal exporters. Prefer it while
// provisioned, retaining modern-key support for projects without a legacy key.
export function serverKey(getEnv) {
  const legacy = getEnv('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  if (legacy) return legacy;
  try {
    const modern = JSON.parse(getEnv('SUPABASE_SECRET_KEYS') || '{}')?.default;
    return typeof modern === 'string' ? modern.trim() : '';
  } catch {
    return '';
  }
}

export function trainingHeaders(key, offset, limit) {
  const headers = {
    apikey: key,
    accept: 'application/json',
    'range-unit': 'items',
    range: `${offset}-${offset + limit - 1}`,
  };
  // Modern secret keys are not JWTs and must never be sent as bearer tokens.
  if (key.startsWith('eyJ')) headers.authorization = `Bearer ${key}`;
  return headers;
}
