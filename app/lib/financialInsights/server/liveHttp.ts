import { InsightsError } from "../contracts";
import {
  analyzeAuthorized,
  validateLiveRequest,
  type LiveAnalysisDependencies,
} from "./live";

const MAX_BYTES = 8192;
const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie",
};
export async function handleLiveAnalysis(
  request: Request,
  deps: LiveAnalysisDependencies | null,
): Promise<Response> {
  const fail = (code: string, status: number) =>
    Response.json(
      {
        error: {
          code,
          message:
            "We could not generate the analysis. Your report and financial totals remain available.",
        },
      },
      { status, headers },
    );
  try {
    if (request.method !== "POST") return fail("METHOD_NOT_ALLOWED", 405);
    const target = new URL(request.url),
      host = request.headers.get("host") ?? target.host;
    if (
      !/^[a-zA-Z0-9.-]+(?::\d{1,5})?$/.test(host) ||
      request.headers.get("origin") !== `${target.protocol}//${host}` ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      return fail("ORIGIN_REJECTED", 403);
    if (
      !deps ||
      !deps.providerLabel ||
      !deps.retentionNotice ||
      !deps.model ||
      Object.values(deps.limits).some(
        (value) => !Number.isFinite(value) || value <= 0,
      )
    )
      return fail("SERVICE_UNAVAILABLE", 503);
    const session = await deps.authenticate(request);
    if (!session || !session.emailVerified)
      return fail("AUTHENTICATION_REQUIRED", 401);
    if (
      request.headers.get("content-type")?.split(";")[0].trim() !==
      "application/json"
    )
      return fail("INVALID_REQUEST", 415);
    const length = request.headers.get("content-length");
    if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES))
      return fail("REQUEST_TOO_LARGE", 413);
    const reader = request.body?.getReader();
    if (!reader) return fail("INVALID_REQUEST", 400);
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BYTES) {
        await reader.cancel();
        return fail("REQUEST_TOO_LARGE", 413);
      }
      chunks.push(chunk.value);
    }
    let value: unknown;
    try {
      value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return fail("INVALID_REQUEST", 400);
    }
    return Response.json(
      await analyzeAuthorized(
        request,
        session,
        validateLiveRequest(value),
        deps,
      ),
      { headers },
    );
  } catch (error) {
    if (error instanceof InsightsError) return fail(error.code, error.status);
    return fail("SERVICE_UNAVAILABLE", 503);
  }
}
