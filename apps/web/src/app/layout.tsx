import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import "./access.css";
import React from "react";

export const metadata: Metadata = {
  title: "CareIQ",
  description: "A calmer workspace for patients and appointments",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const configured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
  return (
    <html
      lang="en">
      <body>
        {configured ? <ClerkProvider dynamic={process.env.NODE_ENV === "production"} signInUrl="/sign-in" signUpUrl="/sign-up" signInFallbackRedirectUrl="/" signUpFallbackRedirectUrl="/" taskUrls={{ "choose-organization": "/session-tasks", "reset-password": "/session-tasks", "setup-mfa": "/session-tasks" }} appearance={{ variables: {
          colorPrimary: "#496f5a",
          colorBackground: "#ffffff",
          colorForeground: "#2b3832",
          colorMutedForeground: "#626f68",
          colorInput: "#ffffff",
          colorInputForeground: "#2b3832",
          colorBorder: "#e4e9e6",
          borderRadius: "10px",
          fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
        } }}>
          {children}
        </ClerkProvider> : children}
      </body>
    </html>
  );
}
