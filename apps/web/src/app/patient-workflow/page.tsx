import { PatientWorkflow } from "@/components/workflow/PatientWorkflow";
import { I18nProvider } from "@/i18n/provider";
import { requestLocale } from "@/i18n/server";
export default async function PatientWorkflowPage() { return <I18nProvider scope="patient" initialLocale={await requestLocale("patient")}><PatientWorkflow /></I18nProvider>; }
