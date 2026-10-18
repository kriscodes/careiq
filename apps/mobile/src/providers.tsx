import { ClerkProvider, useUser } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Component, useCallback, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { configuration } from "./environment";
import { SessionProvider } from "./session";
import { Note, Page } from "./ui";
import { LocaleProvider, useI18n } from "./i18n";
import type { Locale } from "../../../packages/i18n";
import { createLocaleSaveQueue } from "./i18n-policy";
import { enUS } from "@clerk/localizations/en-US";
import { esES } from "@clerk/localizations/es-ES";
class AuthenticationBoundary extends Component<{
  children: ReactNode;
}, {
  failed: boolean;
}> {
  state = {
    failed: false
  };
  static getDerivedStateFromError() {
    return {
      failed: true
    };
  }
  render() {
    return this.state.failed ? <AuthenticationFailure /> : this.props.children;
  }
}
function AuthenticationFailure() { const {t}=useI18n(); return <Page title={t("mobile.provider.failedTitle")}><Note>{t("mobile.provider.failedBody")}</Note></Page>; }
function AccountLocaleProvider({children}:{children:ReactNode}) {
  const {user}=useUser();
  const {setLocale}=useI18n();
  const accountId=user?.id??null;
  const queue=useMemo(()=>createLocaleSaveQueue(),[]);
  useLayoutEffect(()=>{queue.selectAccount(accountId);},[queue,accountId]);
  const preference=typeof user?.unsafeMetadata?.careiqLocale === "string" ? user.unsafeMetadata.careiqLocale : undefined;
  const save=useCallback(async(locale:Locale)=>{
    setLocale(locale);
    if(user)await queue.save(user.id,locale,async next=>{await user.update({unsafeMetadata:{...user.unsafeMetadata,careiqLocale:next}});});
  },[queue,setLocale,user]);
  return <LocaleProvider scope="staff" accountId={accountId} initialLocale={preference} onLocaleResolved={setLocale} onLocaleChange={save}>{children}</LocaleProvider>;
}
function LocaleAwareClerk({children}:{children:ReactNode}) { const {locale}=useI18n(); return <ClerkProvider publishableKey={configuration.clerkPublishableKey!} tokenCache={tokenCache} localization={locale==="es"?esES:enUS}>{children}</ClerkProvider>; }
export function Providers({
  children
}: {
  children: ReactNode;
}) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        gcTime: 0,
        staleTime: 0
      },
      mutations: {
        retry: false
      }
    }
  }));
  return <QueryClientProvider client={client}>{configuration.clerkPublishableKey ? <AuthenticationBoundary><LocaleAwareClerk><AccountLocaleProvider><SessionProvider>{children}</SessionProvider></AccountLocaleProvider></LocaleAwareClerk></AuthenticationBoundary> : children}</QueryClientProvider>;
}
