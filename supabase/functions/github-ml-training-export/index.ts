import {
  createRemoteJWKSet,
  jwtVerify,
} from "npm:jose@6.1.0";

const GITHUB_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_JWKS = createRemoteJWKSet(
  new URL("https://token.actions.githubusercontent.com/.well-known/jwks"),
);
const EXPECTED_AUDIENCE = "edge-lab-supabase-ml-export";
const EXPECTED_REPOSITORY =
  "Ervinx55/sports-analytics-prediction-system";
const EXPECTED_REF = "refs/heads/master";
const EXPECTED_WORKFLOW_REF =
  "Ervinx55/sports-analytics-prediction-system/.github/workflows/ml-shadow.yml@refs/heads/master";
const ALLOWED_EVENTS = new Set([
  "push",
  "schedule",
  "workflow_dispatch",
]);

class AuthError extends Error {}

function adminKey(): string {
  const modern = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (modern) {
    try {
      const parsed = JSON.parse(modern);
      if (parsed?.default) return String(parsed.default);
    } catch {
      // Fall through to the legacy service-role key.
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}

async function authorize(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) {
    throw new AuthError("missing GitHub OIDC bearer token");
  }

  const token = auth.slice(7).trim();
  let payload;
  try {
    ({ payload } = await jwtVerify(token, GITHUB_JWKS, {
      issuer: GITHUB_ISSUER,
      audience: EXPECTED_AUDIENCE,
      clockTolerance: 5,
    }));
  } catch {
    throw new AuthError("invalid GitHub OIDC token");
  }

  const repository = String(payload.repository || "");
  const ref = String(payload.ref || "");
  const workflowRef = String(payload.workflow_ref || "");
  const eventName = String(payload.event_name || "");

  if (repository !== EXPECTED_REPOSITORY) {
    throw new AuthError("repository claim is not authorized");
  }
  if (ref !== EXPECTED_REF) {
    throw new AuthError("ref claim is not authorized");
  }
  if (workflowRef !== EXPECTED_WORKFLOW_REF) {
    throw new AuthError("workflow_ref claim is not authorized");
  }
  if (!ALLOWED_EVENTS.has(eventName)) {
    throw new AuthError("event_name claim is not authorized");
  }

  return {
    repository,
    ref,
    workflowRef,
    eventName,
    runId: payload.run_id ? String(payload.run_id) : null,
  };
}

function boundedInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return Response.json(
        { ok: false, error: "POST only" },
        { status: 405, headers: { "cache-control": "no-store" } },
      );
    }

    const caller = await authorize(req);
    const key = adminKey();
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    if (!key || !supabaseUrl) {
      throw new Error("Supabase server credentials are unavailable");
    }

    const body = await req.json().catch(() => ({}));
    const offset = boundedInteger(
      body?.offset,
      0,
      0,
      10_000_000,
    );
    const limit = boundedInteger(body?.limit, 500, 1, 500);
    const end = offset + limit - 1;

    const url = new URL(
      supabaseUrl + "/rest/v1/player_prop_training_export",
    );
    url.searchParams.set("select", "*");
    url.searchParams.set(
      "order",
      "starts_at.asc,feature_available_at.asc,observation_id.asc",
    );

    const headers: Record<string, string> = {
      apikey: key,
      accept: "application/json",
      "range-unit": "items",
      range: offset + "-" + end,
    };
    if (key.startsWith("eyJ")) {
      headers.authorization = "Bearer " + key;
    }

    const response = await fetch(url, {
      method: "GET",
      headers,
    });
    const text = await response.text();
    let rows: unknown;
    try {
      rows = JSON.parse(text);
    } catch {
      throw new Error(
        "training export returned non-JSON response: " +
          text.slice(0, 200),
      );
    }

    if (!response.ok || !Array.isArray(rows)) {
      throw new Error(
        "training export failed with HTTP " +
          response.status +
          ": " +
          text.slice(0, 300),
      );
    }

    const done = rows.length < limit;
    return Response.json(
      {
        ok: true,
        schemaVersion: 1,
        source: "player_prop_training_export",
        generatedAt: new Date().toISOString(),
        offset,
        limit,
        returned: rows.length,
        done,
        nextOffset: done ? null : offset + rows.length,
        caller,
        rows,
      },
      {
        headers: {
          "cache-control": "no-store",
          "content-type": "application/json",
        },
      },
    );
  } catch (error) {
    const status = error instanceof AuthError ? 401 : 500;
    return Response.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : String(error),
      },
      {
        status,
        headers: {
          "cache-control": "no-store",
          "content-type": "application/json",
        },
      },
    );
  }
});