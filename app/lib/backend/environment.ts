export function backendEnvironmentValid(
  environment: Record<string, string | undefined>,
) {
  if (
    Object.keys(environment).some(
      (name) =>
        /^NEXT_PUBLIC_.*(?:SECRET|PRIVATE|OPENAI|AI_API_KEY)/i.test(name) &&
        environment[name],
    )
  )
    return false;
  if (
    !environment.DATABASE_URL ||
    !environment.CLERK_SECRET_KEY ||
    !environment.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
    !environment.APP_URL
  )
    return false;
  try {
    const app = new URL(environment.APP_URL);
    if (
      app.username ||
      app.password ||
      app.pathname !== "/" ||
      app.search ||
      app.hash
    )
      return false;
    if (
      app.protocol !== "https:" &&
      !(
        environment.NODE_ENV !== "production" &&
        ["localhost", "127.0.0.1"].includes(app.hostname)
      )
    )
      return false;
  } catch {
    return false;
  }
  const production = environment.VERCEL_ENV === "production";
  if (
    environment.NODE_ENV === "production" &&
    environment.APP_DATA_ENV !== (production ? "production" : "preview")
  )
    return false;
  const expected = production ? "live" : "test";
  return (
    environment.CLERK_SECRET_KEY.startsWith(`sk_${expected}_`) &&
    environment.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.startsWith(`pk_${expected}_`)
  );
}
