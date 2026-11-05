/** Owner verification always calls Auth; JWT payloads and editable metadata are not trusted. */
export function accountsConfig(env = process.env) {
    const owner = env.ACCOUNTS_OWNER_ID;
    let url;
    try {
        url = new URL(env.SUPABASE_URL);
        if (url.protocol !== 'https:' || !/^[a-z0-9-]+[.]supabase[.]co$/.test(url.hostname) || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
            url = null;
    }
    catch {
    }
    const key = env.SUPABASE_PUBLISHABLE_KEY;
    return { ready: env.ACCOUNTS_ENABLED === 'true' && !!url && typeof key === 'string' && /^sb_publishable_[A-Za-z0-9_-]+$/.test(key) && typeof owner === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(owner), url: url?.origin, key, owner };
}
export async function privateFetch(url, options, fetchImpl = fetch) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
        const response = await fetchImpl(url, { ...options, cache: 'no-store', redirect: 'error', signal: controller.signal });
        if (!response.ok && !response.body?.getReader && !response.json)
            return { ok: false, status: response.status };
        let data;
        if (response.body?.getReader) {
            const reader = response.body.getReader();
            const chunks = [];
            let size = 0;
            for (;;) {
                const { value, done } = await reader.read();
                if (done)
                    break;
                size += value.byteLength;
                if (size > 8388608) {
                    await reader.cancel();
                    throw Error('Response limit');
                }
                chunks.push(Buffer.from(value));
            }
            data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        }
        else
            data = await response.json();
        return { ok: response.ok, status: response.status, data };
    }
    finally {
        clearTimeout(timer);
    }
}
export async function verifyOwner(req, config, fetchImpl) {
    const value = req.headers?.authorization;
    if (typeof value !== 'string' || value.length > 8192 || !/^Bearer [A-Za-z0-9._~-]+$/.test(value))
        return { status: 401 };
    const response = await privateFetch(`${config.url}/auth/v1/user`, { headers: { apikey: config.key, Authorization: value } }, fetchImpl);
    if (!response.ok)
        return { status: 401 };
    const user = response.data;
    if (user?.id !== config.owner || user.is_anonymous === true || (!user.email_confirmed_at && !user.phone_confirmed_at))
        return { status: 403 };
    return { authorization: value };
}

