import { PatientPaperworkLibrary } from "@/components/workflow/PatientPaperworkLibrary";
import { I18nProvider } from "@/i18n/provider";
import { requestLocale } from "@/i18n/server";
import { translate } from "../../../../../packages/i18n";
export default async function PatientPaperworkPage() {
  const locale = await requestLocale("patient");
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY) return <main className="cq-auth-page"><h1>{translate(locale, "workflow.studio.library")}</h1><p>{translate(locale, "workflow.studio.libraryAccess")}</p></main>;
  return <I18nProvider scope="patient" initialLocale={locale}><PatientPaperworkLibrary /></I18nProvider>;
}
