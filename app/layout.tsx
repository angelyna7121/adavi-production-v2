import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Adavi | Net Worth Statement",
  description: "Create a consolidated net worth statement privately in your browser.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
