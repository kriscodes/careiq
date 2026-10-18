"use client";
import { useI18n } from "@/i18n/provider";
import Link from "next/link";
import { designPreviewEnabled } from "@/lib/web-config";
import { AccessHeading, AccessShell } from "./AccessShell";
export function Unavailable() {
  const { t } = useI18n(); return <AccessShell><AccessHeading title={t("access.copy.sign_in_is_unavailable")}>{t("access.copy.careiq_isn_t_ready_to_sign_in_here_yet_contact_your_careiq_administrator_o")}</AccessHeading>{designPreviewEnabled(process.env.NODE_ENV) && <Link className="cq-a-secondary" href="/design-preview">{t("access.copy.open_the_design_preview")}</Link>}</AccessShell>; }
