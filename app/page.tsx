import ReportApp from "./report-app";
import { getVerifiedPaidEntitlement } from "./lib/subscription";

import { userAnalysisCapability } from "./lib/financialInsights/server/runtime";

export const dynamic = "force-dynamic";

export default async function Home() {
  const hasVerifiedPaidEntitlement = await getVerifiedPaidEntitlement();
  return (
    <ReportApp
      hasVerifiedPaidEntitlement={hasVerifiedPaidEntitlement}
      analysisCapability={await userAnalysisCapability()}
    />
  );
}
