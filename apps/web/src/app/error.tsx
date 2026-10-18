"use client";
import { useI18n } from "@/i18n/provider";
import { AccessHeading, AccessShell } from "@/components/access/AccessShell";
export default function ErrorPage({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const { t } = useI18n();
  return <AccessShell><AccessHeading title={t("access.copy.we_couldn_t_open_this_page")}>{t("access.copy.your_account_and_saved_setup_remain_with_careiq_try_opening_the_page_again")}</AccessHeading><button className="cq-a-primary" type="button" onClick={retry}>{t("access.copy.try_again")}</button><a className="cq-a-link" href="/sign-in">{t("access.copy.back_to_sign_in")}</a></AccessShell>;
}
