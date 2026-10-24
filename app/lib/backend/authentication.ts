export type Identity = {
  id: string;
  primaryEmailAddressId: string | null;
  emailAddresses: { id: string; verification?: { status: string } | null }[];
};
export async function verifyIdentity(
  sessionId: string | null,
  loadIdentity: () => Promise<Identity | null>,
) {
  if (!sessionId) return null;
  const identity = await loadIdentity();
  if (!identity || identity.id !== sessionId) return null;
  return {
    clerkUserId: identity.id,
    verifiedEmail: identity.emailAddresses.some(
      (email) =>
        email.id === identity.primaryEmailAddressId &&
        email.verification?.status === "verified",
    ),
  };
}
