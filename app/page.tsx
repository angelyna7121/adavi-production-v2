import ReportApp from "./report-app";
import { getVerifiedPaidEntitlement } from "./lib/subscription";

export default async function Home() {
  const hasVerifiedPaidEntitlement = await getVerifiedPaidEntitlement();
  return <ReportApp hasVerifiedPaidEntitlement={hasVerifiedPaidEntitlement} />;
}
