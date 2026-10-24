import Link from "next/link";
import { redirect } from "next/navigation";
import { authenticatedUser } from "../lib/backend/auth";
import { backendConfigured } from "../lib/backend/db";
import { resolveEntitlement } from "../lib/backend/resolveEntitlement";
import BillingControls from "./billing-controls";
export const dynamic = "force-dynamic";
export default async function Account() {
  let user: Awaited<ReturnType<typeof authenticatedUser>> = null;
  let entitlement: Awaited<ReturnType<typeof resolveEntitlement>> | null = null;
  let unavailable = !backendConfigured();
  if (!unavailable) {
    try {
      user = await authenticatedUser();
      if (user?.emailVerified)
        entitlement = await resolveEntitlement(user.userId);
    } catch {
      unavailable = true;
    }
  }
  if (!unavailable && !user) redirect("/sign-in");
  return (
    <main className="shell">
      <h1>Your account</h1>
      {unavailable ? (
        <p>Financial analysis is not yet available.</p>
      ) : !user?.emailVerified ? (
        <p>
          Verify your primary email in your Clerk account before using paid or
          AI features.
        </p>
      ) : (
        <>
          <p>Access: {entitlement?.source ?? "Unavailable"}</p>
          <p>
            Remaining daily analyses:{" "}
            {entitlement?.remainingAiAnalyses ?? "Unavailable"}
          </p>
          <BillingControls />
        </>
      )}
      <Link href="/">Return to your report</Link>
    </main>
  );
}
