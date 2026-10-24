import "server-only";
import { authenticatedUser } from "./backend/auth";
import { resolveEntitlement } from "./backend/resolveEntitlement";
export async function getVerifiedPaidEntitlement(): Promise<boolean> {
  try {
    const user = await authenticatedUser();
    if (!user?.emailVerified) return false;
    const decision = await resolveEntitlement(user.userId);
    return decision.canExportCsv && decision.canPrintUnbranded;
  } catch {
    return false;
  }
}
