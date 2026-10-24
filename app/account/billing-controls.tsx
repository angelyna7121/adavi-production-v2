"use client";
import { useState } from "react";
export default function BillingControls() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function open(path: string, body: object) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const value = await response.json();
      if (!response.ok || typeof value.url !== "string") throw new Error();
      const url = new URL(value.url);
      if (
        url.protocol !== "https:" ||
        !["checkout.stripe.com", "billing.stripe.com"].includes(url.hostname)
      )
        throw new Error();
      location.assign(url.toString());
    } catch {
      setError("Subscription management is not yet available.");
      setBusy(false);
    }
  }
  return (
    <>
      <p>
        AI availability and included usage depend on your verified account
        entitlement. No analysis is purchased by running a request.
      </p>
      <button
        disabled={busy}
        onClick={() => open("/api/billing/checkout", { plan: "monthly" })}
      >
        View monthly subscription in Checkout
      </button>
      <button
        disabled={busy}
        onClick={() => open("/api/billing/checkout", { plan: "yearly" })}
      >
        View annual subscription in Checkout
      </button>
      <button disabled={busy} onClick={() => open("/api/billing/portal", {})}>
        Manage subscription
      </button>
      <p role="alert">{error}</p>
    </>
  );
}
