"use client";
import { useI18n } from "@/i18n/provider";
import { TaskChooseOrganization, TaskResetPassword, TaskSetupMFA, useSession } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { clearAuthDestination, readAuthDestination } from "@/lib/auth-intent";
import { SignOutButton } from "./SignOutButton";
import { AccessHeading, AccessShell } from "./AccessShell";

export function SessionTasks({ returnTo }: { returnTo?: string }) {
  const { t } = useI18n();
  const { isLoaded, session } = useSession();
  const [destination, setDestination] = useState<string | null>(null);
  useEffect(() => { const restored = readAuthDestination(returnTo); queueMicrotask(() => setDestination(restored)); }, [returnTo]);
  useEffect(() => {
    if (!isLoaded || !destination) return;
    if (!session) window.location.replace(`/sign-in?returnTo=${encodeURIComponent(destination)}`);
    else if (!session.currentTask) { clearAuthDestination(); window.location.replace(destination); }
  }, [isLoaded, session, destination]);
  const task = session?.currentTask?.key;
  return <AccessShell><AccessHeading title={t("access.copy.one_more_step")}>{t("access.copy.complete_the_required_step_for_your_account")}</AccessHeading>{destination && task === "reset-password" ? <TaskResetPassword redirectUrlComplete={destination} /> : destination && task === "setup-mfa" ? <TaskSetupMFA redirectUrlComplete={destination} /> : destination && task === "choose-organization" ? <TaskChooseOrganization redirectUrlComplete={destination} /> : <p role="status">{t("access.copy.checking_your_account")}</p>}<SignOutButton redirectUrl={`/sign-in?returnTo=${encodeURIComponent(destination || "/")}`}>{t("access.copy.use_another_account")}</SignOutButton></AccessShell>;
}
