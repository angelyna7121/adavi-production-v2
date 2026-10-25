import "server-only";
import { DemoAnalysisService } from "./demoService";
export { handleInsightsRequest } from "./http";
export { OpenAIProvider } from "./provider";

export function openAIConfiguration() {
  const rate = (name: string) => process.env[name] === undefined ? undefined : Number(process.env[name]);
  return { apiKey: process.env.OPENAI_API_KEY ?? "", model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini", inputUsdPerMillion: rate("AI_INPUT_USD_PER_MILLION"), outputUsdPerMillion: rate("AI_OUTPUT_USD_PER_MILLION") };
}
// A module singleton survives requests in this process, not Vercel instances.
const requestedDemoAllowance = Number(process.env.DEMO_ANALYSIS_ALLOWANCE ?? 4);
const demoAllowance = Number.isSafeInteger(requestedDemoAllowance) && requestedDemoAllowance >= 1 && requestedDemoAllowance <= 20 ? requestedDemoAllowance : 4;
export const demoAnalysisService = new DemoAnalysisService({ allowance: demoAllowance });
