// Server-side configuration only. Never select credentials from request input.
export function serviceRoleKey(getEnv = name => Deno.env.get(name)) {
 const override = getEnv('EDGE_LAB_SERVICE_ROLE_KEY')?.trim();
 const key = override || getEnv('SUPABASE_SERVICE_ROLE_KEY')?.trim();
 if (!key) throw new Error('Backend service credential is not configured');
 return key;
}
