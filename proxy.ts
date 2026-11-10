import { backendEnvironmentValid } from "./app/lib/backend/environment";
import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
const configured = backendEnvironmentValid(process.env);
export default configured
  ? clerkMiddleware({
      authorizedParties: process.env.APP_URL
        ? [new URL(process.env.APP_URL).origin]
        : [],
    })
  : () => NextResponse.next();
export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|pdf|wasm|gz|mjs)).*)",
    "/(api|trpc)(.*)",
  ],
};
