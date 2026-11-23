// Authorize the signed role only after the Supabase gateway has verified the
// JWT signature and expiry. Deployment MUST retain verify_jwt=true: this helper
// does not perform signature verification and is not a standalone JWT verifier.
export function isServiceRoleRequest(request) {
  const match = request.headers.get("authorization")?.match(
    /^Bearer[ \t]+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i,
  );
  if (!match) return false;
  try {
    const encoded = match[1].split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=")));
    return payload !== null && typeof payload === "object" &&
      !Array.isArray(payload) && payload.role === "service_role";
  } catch {
    return false;
  }
}
