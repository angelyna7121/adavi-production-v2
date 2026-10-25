import { backendConfigured } from "../../lib/backend/db";
import { SignIn } from "@clerk/nextjs";
export default function SignInPage() {
  return backendConfigured() ? (
    <SignIn />
  ) : (
    <main className="shell">
      <h1>Sign in</h1>
      <p>Account access is not yet configured.</p>
    </main>
  );
}
