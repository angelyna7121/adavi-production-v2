import { createHash } from "node:crypto";
import { demoInsights, demoSummary, DEMO_VERSION } from "../demo";
import { InsightsError, validateInsights, type AnalysisResult, type DemoScope } from "../contracts";

export type DemoUsageRecord = { requests: number; successes: number; failures: number; inputTokens: number; outputTokens: number; estimatedCostUsd: number; latencyMs: number };
type Entry = { until: number; count: number };

/** Public synthetic-only service. Bounded process-local state is intentionally
 * not a production billing ledger or a multi-instance entitlement store. */
export class DemoAnalysisService {
  private readonly completed = new Map<string, { until: number; result: AnalysisResult }>();
  private readonly pending = new Map<string, Promise<AnalysisResult>>();
  private readonly rate = new Map<string, Entry>();
  private readonly usage = new Map<string, DemoUsageRecord>();
  constructor(private readonly options: { now?: () => number; generate?: typeof demoInsights; allowance?: number } = {}) {
    if (options.allowance !== undefined && (!Number.isSafeInteger(options.allowance) || options.allowance < 1 || options.allowance > 20)) throw new InsightsError("INVALID_DEMO_ALLOWANCE");
  }
  private now() { return (this.options.now ?? Date.now)(); }
  private prune() {
    const now = this.now();
    for (const [key, entry] of this.completed) if (entry.until <= now) this.completed.delete(key);
    for (const [key, entry] of this.rate) if (entry.until <= now) this.rate.delete(key);
    if (this.usage.size > 256) this.usage.delete(this.usage.keys().next().value!);
  }
  private take(key: string, max: number) {
    const entry = this.rate.get(key) ?? { count: 0, until: this.now() + 60000 };
    if (entry.count >= max) throw new InsightsError("RATE_LIMITED", 429);
    entry.count++; this.rate.set(key, entry);
  }
  getUsage(session: string) { return this.usage.get(session); }
  async analyze(session: string, scope: DemoScope, consent: boolean): Promise<AnalysisResult> {
    if (!consent) throw new InsightsError("CONSENT_REQUIRED");
    if (!/^[0-9a-f-]{36}$/.test(session) || !["individual", "consolidated"].includes(scope)) throw new InsightsError("INVALID_REQUEST");
    this.prune();
    // Global bound prevents forged/new public demo sessions growing memory or
    // bypassing per-session throttling. No money or private data is involved.
    this.take("global", 60);
    this.take(session, 12);
    const summary = demoSummary(scope);
    const key = createHash("sha256").update(JSON.stringify({ session, scope, dataVersion: DEMO_VERSION, summary, provider: "handwritten-demo", configuration: "demo-v1" })).digest("hex");
    const cached = this.completed.get(key);
    if (cached) return { ...cached.result, cached: true };
    const inFlight = this.pending.get(key);
    if (inFlight) return { ...await inFlight, cached: true };
    const record = this.usage.get(session) ?? { requests: 0, successes: 0, failures: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, latencyMs: 0 };
    if (record.requests >= (this.options.allowance ?? 4)) throw new InsightsError("DEMO_ALLOWANCE_EXHAUSTED", 429);
    if (this.pending.size >= 16 || this.completed.size >= 256) throw new InsightsError("SERVICE_BUSY", 503);
    record.requests++; this.usage.set(session, record);
    const start = this.now();
    const operation = Promise.resolve().then(() => {
      const insights = validateInsights((this.options.generate ?? demoInsights)(summary), summary);
      const result: AnalysisResult = { source: "demonstration", summary, insights, usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, latencyMs: this.now() - start }, cached: false };
      this.completed.set(key, { result, until: this.now() + 15 * 60000 });
      record.successes++; record.latencyMs += result.usage.latencyMs;
      return result;
    }).catch(() => { record.failures++; throw new InsightsError("DEMO_FAILED", 503); }).finally(() => { this.pending.delete(key); });
    this.pending.set(key, operation);
    return operation;
  }
}
