"use client";
import { useAuth, useUser, UserButton } from "@clerk/nextjs";
import { useI18n } from "@/i18n/provider";
import { useMemo, type ReactNode } from "react";
import type { ApplicationPageFrame, NavigationGuard } from "@/lib/application-navigation";
import { ApiError } from "@/lib/api/client";
import { createCommunicationsAdapter } from "@/lib/api/communications";
import { createWorkflowAdapter } from "@/lib/api/workflow";
import { PracticePicker } from "../PracticeAccess";
import { WorkflowWorkspace, type WorkspaceView } from "./WorkflowWorkspace";
export function AuthenticatedWorkflow({ orgId, locationId, practiceName, onAccessDenied, initialView, onHome, accessTools, renderFrame, onWorkspaceViewChange }: { orgId: string; locationId: string; practiceName: string; onAccessDenied: () => void; initialView?: WorkspaceView; onHome?: () => void; accessTools?: (navigate: NavigationGuard) => ReactNode; renderFrame?: ApplicationPageFrame; onWorkspaceViewChange?: (view: WorkspaceView) => void }) {
  const { t } = useI18n();
  const { getToken } = useAuth(); const { user } = useUser();
  const adapter = useMemo(() => createWorkflowAdapter(locationId, async () => { const token = await getToken({ organizationId: orgId, skipCache: true }); if (!token) throw new ApiError(401, "SESSION_EXPIRED", "SESSION_EXPIRED"); return token; }, onAccessDenied), [getToken, orgId, locationId, onAccessDenied]);
  const communicationsAdapter = useMemo(() => createCommunicationsAdapter(locationId, async () => { const token = await getToken({ organizationId: orgId, skipCache: true }); if (!token) throw new ApiError(401, "SESSION_EXPIRED", "SESSION_EXPIRED"); return token; }, onAccessDenied), [getToken, orgId, locationId, onAccessDenied]);
  return <WorkflowWorkspace initialView={initialView} onHome={onHome} accessTools={accessTools} renderFrame={renderFrame} onWorkspaceViewChange={onWorkspaceViewChange} communicationsAdapter={communicationsAdapter} key={`${orgId}:${locationId}`} onAccessDenied={onAccessDenied} currentUserId={user?.id} adapter={adapter} practiceName={practiceName} renderContextPicker={navigate => <PracticePicker currentPracticeName={practiceName} onNavigate={navigate} />} account={<div className="wf-actions"><UserButton /><small>{user?.firstName ?? t("workflow.labels.yourAccount")}</small></div>} />;
}
