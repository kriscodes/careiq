import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import "./access.css";
import React from "react";
import { I18nProvider } from "@/i18n/provider";
import { requestLocale } from "@/i18n/server";
import { AccountLocaleBridge } from "@/i18n/AccountLocaleBridge";
import { LocaleRefresh } from "@/i18n/LocaleRefresh";
import { enUS } from "@clerk/localizations/en-US";
import { esES } from "@clerk/localizations/es-ES";
import { directionOf, translate } from "../../../../packages/i18n";
import "../../../../packages/i18n/web.css";

export async function generateMetadata(): Promise<Metadata> { return {
  title: "CareIQ",
  description: translate(await requestLocale(), "common.meta.description"),
  robots: { index: false, follow: false },
}; }

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const configured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
  const locale = await requestLocale();
  return (
    <html
      lang={locale} dir={directionOf(locale)}>
      <body>
        <I18nProvider initialLocale={locale}>
        <LocaleRefresh />
        {configured ? <ClerkProvider localization={locale === "es" ? esES : enUS} dynamic={process.env.NODE_ENV === "production"} signInUrl="/sign-in" signUpUrl="/sign-up" signInFallbackRedirectUrl="/" signUpFallbackRedirectUrl="/" taskUrls={{ "choose-organization": "/session-tasks", "reset-password": "/session-tasks", "setup-mfa": "/session-tasks" }} appearance={{ variables: {
          colorPrimary: "#0067e8",
          colorBackground: "#ffffff",
          colorForeground: "#202b34",
          colorMutedForeground: "#617080",
          colorInput: "#ffffff",
          colorInputForeground: "#202b34",
          colorBorder: "#e1e7ef",
          borderRadius: "10px",
          fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
        } }}>
          <AccountLocaleBridge />{children}
        </ClerkProvider> : children}
        </I18nProvider>
      </body>
    </html>
  );
}
