import { backendConfigured } from "../../lib/backend/db";
import { SignUp } from "@clerk/nextjs";
export default function SignUpPage() {
  return backendConfigured() ? (
    <SignUp />
  ) : (
    <main className="shell">
      <h1>Create an account</h1>
      <p>Account access is not yet configured.</p>
    </main>
  );
}
