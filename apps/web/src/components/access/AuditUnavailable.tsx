"use client";
import { useI18n } from "@/i18n/provider";
import { AccessHeading, AccessShell } from "./AccessShell";
export function AuditUnavailable() { const {t}=useI18n();return <AccessShell><AccessHeading title={t("access.copy.audit_review")}>{t("common.audit.connect")}</AccessHeading></AccessShell>; }
