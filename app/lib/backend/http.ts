import { InsightsError } from "../financialInsights/contracts";
export function sameOrigin(request: Request) {
  const url = new URL(request.url),
    host = request.headers.get("host") ?? url.host;
  return (
    /^[a-zA-Z0-9.-]+(?::\d{1,5})?$/.test(host) &&
    request.headers.get("origin") === `${url.protocol}//${host}` &&
    request.headers.get("sec-fetch-site") !== "cross-site"
  );
}
export async function boundedJson(
  request: Request,
  maximum = 65536,
): Promise<unknown> {
  if (!sameOrigin(request)) throw new InsightsError("ORIGIN_REJECTED", 403);
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
    throw new InsightsError("INVALID_REQUEST", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new InsightsError("INVALID_REQUEST");
  let size = 0;
  const chunks = [];
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.length;
    if (size > maximum) {
      await reader.cancel();
      throw new InsightsError("REQUEST_TOO_LARGE", 413);
    }
    chunks.push(chunk.value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new InsightsError("INVALID_REQUEST");
  }
}
export function safeFailure(error: unknown) {
  return Response.json(
    {
      error: {
        code:
          error instanceof InsightsError ? error.code : "SERVICE_UNAVAILABLE",
        message: "This service is temporarily unavailable.",
      },
    },
    {
      status: error instanceof InsightsError ? error.status : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
