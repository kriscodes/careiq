import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import React from "react";

export const metadata: Metadata = {
  title: "CareIQ",
  description: "A calmer workspace for patients and appointments",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en">
      <body>
        <ClerkProvider appearance={{ variables: {
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
        </ClerkProvider>
      </body>
    </html>
  );
}
