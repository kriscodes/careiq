import { useState } from 'react';
import { ManagerActivityHarness } from './manager-activity-entry';
import { I18nProvider } from '../../../src/i18n/provider';
import { AccountLocaleBridge } from '../../../src/i18n/AccountLocaleBridge';
import { AuditConsole } from '../../../src/components/AuditConsole';
import { PortalAccessManager } from '../../../src/components/workflow/PortalAccessManager';
import { ApiError } from '../../../src/lib/api/client';
import type { WorkflowAdapter } from '../../../src/lib/api/workflow';
import { createWorkflowAdapter } from '../../../src/lib/api/workflow';
import { WorkflowWorkspace } from '../../../src/components/workflow/WorkflowWorkspace';
import { createPreviewAdapter } from '../../../src/components/workflow/preview-adapter';
import { PatientPaperworkLibrary } from '../../../src/components/workflow/PatientPaperworkLibrary';
import { PatientWorkflow } from '../../../src/components/workflow/PatientWorkflow';
import { createRoot } from 'react-dom/client';
import { PersonalAccountSettings } from '../../../src/components/access/PersonalAccountSettings';
import {
  OwnershipTransfer,
  type OwnershipTransferPayload,
} from '../../../src/components/access/OwnershipTransfer';
import type { PracticeMember, WorkspaceView } from '../../../src/lib/api/practice';
import { AuthScreen } from '../../../src/components/access/AuthScreen';
import { PracticeOnboarding } from '../../../src/components/access/PracticeOnboarding';
import { PracticeManagement } from '../../../src/components/access/PracticeManagement';
import { PracticeWorkspace } from '../../../src/components/PracticeWorkspace';
import { PracticePicker } from '../../../src/components/PracticeAccess';
import type { AccessContext } from '../../../src/lib/api/practice';
const params = new URLSearchParams(location.search);
const owner: AccessContext = {
  userId: 'user_test',
  orgId: 'org_test',
  practice: {
    id: 'practice_test',
    name: 'Test practice',
    authorizationMode: 'location',
    status: 'active',
  },
  onboarding: 'ready',
  enrollmentStatus: 'active',
  capabilities: {
    patients: { read: true, create: true },
    appointments: { read: true, create: true },
  },
  management: { locations: true, members: true },
  locations: [],
};
const component = params.get('component');
const root = document.getElementById('root')!;
function PortalHarness() {
  window.__careiqMockCalls ||= [];
  const [adapter] = useState(() =>
    createWorkflowAdapter(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      async () => 'synthetic-browser-test-token',
      () => window.__careiqMockCalls.push({ name: 'accessDenied' }),
    ),
  );
  return (
    <div className="wf-root">
      <PortalAccessManager
        adapter={adapter}
        patientId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        onChanged={() => window.__careiqMockCalls.push({ name: 'portalChanged' })}
      />
    </div>
  );
}

declare global {
  interface Window {
    __careiqSchedulingFixture?: { revoke: () => void; releaseAvailability: () => void };
  }
}
function schedulingScenario(base: WorkflowAdapter) {
  const scenario = params.get('scenario') ?? '';
  if (!scenario.startsWith('scheduling')) {
    return base;
  }
  const load = base.load.bind(base),
    detail = base.detail.bind(base),
    page = base.page.bind(base);
  let revoked = false;
  let releaseAvailability = () => {};
  window.__careiqSchedulingFixture = {
    revoke: () => {
      revoked = true;
    },
    releaseAvailability: () => releaseAvailability(),
  };
  base.load = async (date, signal, options) => {
    window.__careiqMockCalls.push({ name: 'workflowLoad', input: { date } });
    if (revoked && scenario === 'scheduling-revoked-http') {
      throw new ApiError(403, 'FORBIDDEN', 'FORBIDDEN');
    }
    const snapshot = await load(date, signal, options);
    // A second day proves the weekly planner loads more than Today's queue.
    snapshot.patients.push({
      id: 'weekly-patient',
      firstName: 'Weekly',
      lastName: 'Witness',
      email: null,
      phone: null,
    });
    snapshot.appointments.push({
      id: 'weekly-appointment',
      patientId: 'weekly-patient',
      providerId: 'dr2',
      visitTypeId: 'followup',
      scheduledAt: '2026-10-14T17:00:00.000Z',
      endsAt: '2026-10-14T17:30:00.000Z',
      status: 'scheduled',
      reason: 'Synthetic midweek visit',
      revision: 1,
      readiness: { status: 'not_required', requiredCount: 0 },
    });
    if (revoked) {
      snapshot.capabilities = { ...snapshot.capabilities, appointmentsRead: false };
    }
    return snapshot;
  };
  base.page = async (resource, signal) => {
    window.__careiqMockCalls.push({ name: 'workflowPage', input: { resource } });
    return page(resource, signal);
  };
  base.detail = async <T,>(resource: string, signal?: AbortSignal): Promise<T> => {
    window.__careiqMockCalls.push({ name: 'workflowDetail', input: { resource } });
    if (!resource.startsWith('availability?')) {
      return detail<T>(resource, signal);
    }
    if (scenario === 'scheduling-availability-error') {
      throw new ApiError(503, 'UNAVAILABLE', 'UNAVAILABLE');
    }
    if (scenario === 'scheduling-availability-empty') {
      return { slots: [] } as T;
    }
    if (scenario === 'scheduling-availability-stale') {
      return new Promise<T>((resolve, reject) => {
        // Deliberately ignore abort so the UI must reject a stale success itself.
        releaseAvailability = () => {
          void detail<T>(resource).then(resolve, reject);
        };
      });
    }
    return detail<T>(resource, signal);
  };
  return base;
}

function WorkflowHarness() {
  window.__careiqMockCalls ||= [];
  const [adapter] = useState(() => {
    const base = createPreviewAdapter();
    const command = base.command.bind(base);
    const load = base.load.bind(base);
    let failed = false;
    base.command = async (resource, body, options) => {
      window.__careiqMockCalls.push({
        name: 'workflowCommand',
        input: { resource, body, key: options?.key },
      });
      if (params.get('scenario') === 'save-failure' && !failed) {
        failed = true;
        throw new Error('Temporary network failure. Your entries are still here.');
      }
      return command(resource, body, options);
    };
    if (base.insurance && params.get('scenario') === 'insurance-save-failure') {
      const evidence = base.insurance.evidence.bind(base.insurance);
      let evidenceFailed = false;
      base.insurance.evidence = async (id, input, options) => {
        window.__careiqMockCalls.push({
          name: 'insuranceEvidence',
          input: { id, input, key: options.key },
        });
        const result = await evidence(id, input, options);
        if (!evidenceFailed) {
          evidenceFailed = true;
          throw new Error('Synthetic response dropped after save');
        }
        return result;
      };
    }
    if (base.insurance && params.get('scenario') === 'insurance-readonly') {
      const list = base.insurance.cases.bind(base.insurance);
      base.insurance.cases = async (...args) => ({
        ...(await list(...args)),
        meta: { capabilities: { read: true, manage: false, evidence: false, activity: false } },
      });
      base.load = async (date, signal) => ({
        ...(await load(date, signal)),
        capabilities: { patientsRead: true, appointmentsRead: true },
      });
    }
    if (params.get('scenario') === 'readonly') {
      base.load = async (date, signal) => ({
        ...(await load(date, signal)),
        capabilities: { patientsRead: true, appointmentsRead: true, documentsRead: true },
      });
    }
    return schedulingScenario(base);
  });
  const initialView = ['Today', 'Schedule', 'Patients', 'Documents', 'Templates'].includes(
    params.get('initialView') ?? '',
  )
    ? (params.get('initialView') as WorkspaceView)
    : undefined;
  return (
    <WorkflowWorkspace
      adapter={adapter}
      practiceName="Synthetic practice"
      initialView={initialView}
      renderContextPicker={
        params.get('contextPicker') === '1'
          ? (navigate) => (
              <PracticePicker currentPracticeName="Synthetic practice" onNavigate={navigate} />
            )
          : undefined
      }
      accessTools={
        params.get('headerTools') === '1'
          ? (navigate) => (
              <button
                type="button"
                className="wf-link"
                onClick={() =>
                  navigate(() => window.__careiqMockCalls.push({ name: 'workflowSettings' }))
                }
              >
                Practice Settings
              </button>
            )
          : undefined
      }
      onHome={
        params.get('home') === '1'
          ? () => window.__careiqMockCalls.push({ name: 'workflowHome' })
          : undefined
      }
    />
  );
}
function OwnershipHarness() {
  const [practice, setPractice] = useState({
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Synthetic Practice',
  });
  const [removed, setRemoved] = useState(false);
  const [pending, setPending] = useState(false);
  const member = (
    userId: string,
    role: string,
    status = 'active',
    isOwner = false,
  ): PracticeMember => ({
    userId,
    membershipId: `mem_${userId}`,
    displayName: userId === 'user_AdminA' ? 'Alex' : userId === 'user_AdminB' ? 'Blair' : userId,
    email: `${userId}@example.invalid`,
    role,
    status,
    isOwner,
    locationIds: [],
  });
  const members = [
    member('user_Owner', 'org:admin', 'active', true),
    ...(!removed ? [member('user_AdminA', 'org:admin')] : []),
    member('user_AdminB', 'org:admin'),
    member('user_Suspended', 'org:admin', 'suspended'),
    member('user_Pending', 'org:admin', 'pending_assignment'),
    member('user_Member', 'org:member'),
  ];
  async function transfer(payload: OwnershipTransferPayload) {
    window.__careiqMockCalls ||= [];
    window.__careiqMockCalls.push({ name: 'transferOwnership', input: payload });
    if (params.get('scenario') === 'ownership-pending') {
      setPending(true);
      await new Promise<void>(() => {});
    }
    if (params.get('scenario') === 'ownership-error') {
      throw new Error('Synthetic denied transfer');
    }
  }
  return (
    <main className="cq-setup">
      <OwnershipTransfer
        practice={practice}
        members={members}
        busy={pending}
        onTransfer={transfer}
      />
      <button onClick={() => setPractice((old) => ({ ...old, name: 'Renamed Practice' }))}>
        Rename fixture practice
      </button>
      <button
        onClick={() =>
          setPractice((old) => ({ ...old, id: '22222222-2222-4222-8222-222222222222' }))
        }
      >
        Switch fixture practice
      </button>
      <button onClick={() => setRemoved((old) => !old)}>Change fixture eligibility</button>
    </main>
  );
}
createRoot(root).render(
  <I18nProvider
    scope={
      component === 'patient-workflow' || component === 'patient-paperwork' ? 'patient' : 'staff'
    }
  >
    {params.get('scenario') === 'locale-account' && <AccountLocaleBridge />}
    {component === 'manager-activity' ? (
      <ManagerActivityHarness />
    ) : component === 'personal-account' ? (
      <PersonalAccountSettings
        onBack={() => window.__careiqMockCalls.push({ name: 'accountBack' })}
      />
    ) : component === 'ownership' ? (
      <OwnershipHarness />
    ) : component === 'audit' ? (
      <AuditConsole />
    ) : component === 'portal-access' ? (
      <PortalHarness />
    ) : component === 'workflow' ? (
      <WorkflowHarness />
    ) : component === 'patient-paperwork' ? (
      <PatientPaperworkLibrary />
    ) : component === 'patient-workflow' ? (
      <PatientWorkflow />
    ) : component === 'onboarding' ? (
      <PracticeOnboarding
        onInvitations={() => {
          window.__careiqMockCalls.push({ name: 'viewInvitations' });
        }}
      />
    ) : component === 'owneraccess' || component === 'invite' ? (
      <PracticeManagement
        context={owner}
        mode={component}
        onDone={() => {
          window.__careiqMockCalls.push({ name: 'managementDone' });
        }}
      />
    ) : component === 'workspace' ? (
      <PracticeWorkspace
        initialView={params.get('view') === 'invitations' ? 'invitations' : 'entry'}
      />
    ) : (
      <AuthScreen
        initialMode={params.get('mode') === 'signup' ? 'signup' : 'signin'}
        returnTo={params.get('returnTo') ?? undefined}
        invitation={params.get('scenario') === 'signed-invite'}
        expired={params.get('scenario') === 'signed-expired'}
      />
    )}
  </I18nProvider>,
);
