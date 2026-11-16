import { createElement, type ReactNode } from 'react';
import type { useI18n } from '@/i18n/provider';
type Translate = ReturnType<typeof useI18n>['t'];
import { InterviewIcon, type InterviewIconName } from '@/components/InterviewIcon';
import type { ApplicationFrameItem } from '@/components/workflow/ApplicationFrame';
import type { WorkspaceView } from './api/practice';
import { communicationText } from '@/components/workflow/communication-i18n';

export type NavigationGuard = (action: () => void, source?: HTMLElement) => void;
export type ApplicationFrameOptions = {
  guard?: NavigationGuard;
  activeItem?: string;
  navigate?: (id: string) => void;
  tools?: ReactNode;
  blocked?: boolean;
};
export type ApplicationPageFrame = (
  content: ReactNode,
  options?: ApplicationFrameOptions,
) => ReactNode;
export const WORKSPACE_DESTINATIONS: readonly WorkspaceView[] = [
  'Today',
  'Schedule',
  'Patients',
  'Documents',
  'Templates',
  'Manager',
  'Insurance',
  'Communications',
  'Notifications',
];
export function isWorkspaceDestination(value: string): value is WorkspaceView {
  return (WORKSPACE_DESTINATIONS as readonly string[]).includes(value);
}
const icon = (name: InterviewIconName) => createElement(InterviewIcon, { name });
const icons: Record<string, InterviewIconName> = {
  Home: 'home',
  Today: 'clock',
  Schedule: 'calendar',
  Patients: 'users',
  Documents: 'file',
  Templates: 'workflow',
  Manager: 'chart',
  Insurance: 'shield',
  Communications: 'mail',
  Notifications: 'bell',
  Practice: 'settings',
};
// One ordered menu for the whole signed-in staff application. Page snapshots never rewrite it.
export function staffNavigation(
  t: Translate,
  locale: string,
  canManage: boolean,
  locationMode: boolean,
): ApplicationFrameItem[] {
  return [
    {
      id: 'Home',
      label: t('access.home.navHome'),
      icon: icon(icons.Home),
      group: t('access.navigation.workspace'),
    },
    ...WORKSPACE_DESTINATIONS.filter(
      (id) => locationMode || ['Today', 'Schedule', 'Patients'].includes(id),
    ).map((id) => ({
      id,
      label: workspaceLabel(t, locale, id),
      icon: icon(icons[id]),
      ...(id === 'Manager' ? { group: t('access.navigation.operations') } : {}),
    })),
    ...(canManage
      ? [
          {
            id: 'Practice',
            label: t('access.home.settingsLabel'),
            icon: icon(icons.Practice),
            group: t('access.navigation.manage'),
          },
        ]
      : []),
  ];
}

export function workspaceLabel(t: Translate, locale: string, id: WorkspaceView): string {
  return id === 'Communications' || id === 'Notifications'
    ? communicationText(locale, id.toLowerCase())
    : t(`workflow.navigation.${id.toLowerCase()}`);
}
