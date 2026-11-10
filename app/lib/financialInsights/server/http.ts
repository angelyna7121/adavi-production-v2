import { randomUUID } from "node:crypto";
import { InsightsError, type DemoScope } from "../contracts";
import { DemoAnalysisService } from "./demoService";

const COOKIE = "adavi_demo_session";
const MAX_REQUEST_BYTES = 2048;
export async function handleInsightsRequest(request: Request, service: DemoAnalysisService): Promise<Response> {
  const headers = { "Cache-Control": "no-store", "Content-Type": "application/json", "X-Content-Type-Options": "nosniff" };
  const fail = (code: string, status: number) => Response.json({ error: { code, message: "Analysis is unavailable. No customer data was sent to an AI provider." } }, { status, headers });
  try {
    if (request.method !== "POST") return fail("METHOD_NOT_ALLOWED", 405);
    const origin = request.headers.get("origin");
    // Next can normalize request.url to its internal listening hostname. The
    // actual Host remains the public request destination and cannot be changed
    // by a cross-origin browser fetch. Never trust a browser-supplied investor ID
    // or a forwarded-host header as authorization.
    const target = new URL(request.url);
    const host = request.headers.get("host") ?? target.host;
    if (!/^[a-zA-Z0-9.-]+(?::\d{1,5})?$/.test(host) || !origin || origin !== `${target.protocol}//${host}` || request.headers.get("sec-fetch-site") === "cross-site") return fail("ORIGIN_REJECTED", 403);
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return fail("INVALID_REQUEST", 415);
    const contentLength = request.headers.get("content-length");
    if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_REQUEST_BYTES)) return fail("REQUEST_TOO_LARGE", 413);
    // Bound streaming reads even when Content-Length is absent or forged.
    const reader = request.body?.getReader();
    if (!reader) return fail("INVALID_REQUEST", 400);
    let bytes = 0; const chunks: Uint8Array[] = [];
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_REQUEST_BYTES) { await reader.cancel(); return fail("REQUEST_TOO_LARGE", 413); }
      chunks.push(chunk.value);
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).sort().join(",") !== "consent,mode,scope" || payload.consent !== true || !["individual", "consolidated"].includes(payload.scope)) return fail(payload?.consent !== true ? "CONSENT_REQUIRED" : "INVALID_REQUEST", 400);
    // No runtime flag or API key can bypass this gate. Until real authenticated
    // customers, authorized server records and durable allowances exist, live
    // processing is intentionally inaccessible, even to a forged premium claim.
    if (payload.mode === "live") return fail("LIVE_AUTHORIZATION_UNAVAILABLE", 503);
    if (payload.mode !== "demo") return fail("INVALID_REQUEST", 400);
    const cookieValue = request.headers.get("cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    const session = cookieValue && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(cookieValue) ? cookieValue : randomUUID();
    const result = await service.analyze(session, payload.scope as DemoScope, true);
    // Session-scoped caching only for public synthetic fixtures, never customer
    // records. Cookie is opaque, HttpOnly, host-only and not an auth credential.
    return Response.json(result, { headers: { ...headers, "Set-Cookie": `${COOKIE}=${session}; HttpOnly; SameSite=Strict; Path=/api/financial-insights; Max-Age=900${new URL(request.url).protocol === "https:" ? "; Secure" : ""}` } });
  } catch (error) {
    if (error instanceof InsightsError) return fail(error.code, error.status);
    return fail("INVALID_REQUEST", 400);
  }
}
