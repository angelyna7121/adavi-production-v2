import "server-only";
import { auth, currentUser } from "@clerk/nextjs/server";
import { db, backendConfigured } from "./db";
import { verifyIdentity } from "./authentication";
import { users } from "./schema";
export async function authenticatedUser() {
  if (!backendConfigured()) return null;
  const session = await auth();
  if (!session.userId) return null;
  const identity = await verifyIdentity(session.userId, async () =>
    currentUser(),
  );
  if (!identity) return null;
  const [record] = await db()
    .insert(users)
    .values({
      clerkUserId: identity.clerkUserId,
      verifiedEmail: identity.verifiedEmail,
    })
    .onConflictDoUpdate({
      target: users.clerkUserId,
      set: { verifiedEmail: identity.verifiedEmail, updatedAt: new Date() },
    })
    .returning();
  return {
    userId: record.id,
    accountId: record.id,
    emailVerified: identity.verifiedEmail,
    stripeCustomerId: record.stripeCustomerId,
  };
}
