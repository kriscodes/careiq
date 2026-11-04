'use client';

import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useI18n } from '@/i18n/provider';
import { LanguageSelector } from '@/i18n/LanguageSelector';
import './workflow.css';
import './application-frame.css';

export type ApplicationFrameItem = { id: string; label: string; icon: ReactNode; group?: string };
type ApplicationFrameProps = {
  practiceName?: string;
  pageLabel?: string;
  locationName?: string;
  contextPicker?: ReactNode;
  account?: ReactNode;
  items: ApplicationFrameItem[];
  activeItem: string;
  onNavigate: (id: string) => void;
  tools?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  embedded?: boolean;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  navigationDisabled?: boolean;
  navigationLabel?: string;
};
const subscribe = (listener: () => void) => {
  const query = window.matchMedia('(max-width: 760px)');
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
};
const narrowSnapshot = () => window.matchMedia('(max-width: 760px)').matches;

/** The same shell surrounds every authorized page; record access is checked by each destination. */
export function ApplicationFrame({
  practiceName,
  pageLabel,
  locationName,
  contextPicker,
  account,
  items,
  activeItem,
  onNavigate,
  tools,
  footer,
  children,
  embedded = false,
  collapsed,
  onCollapsedChange,
  navigationDisabled = false,
  navigationLabel,
}: ApplicationFrameProps) {
  const { t, locale, direction } = useI18n();
  const navigationId = useId();
  const navigation = useRef<HTMLElement | null>(null);
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const narrow = useSyncExternalStore(subscribe, narrowSnapshot, () => false);
  const navigationCollapsed = collapsed ?? internalCollapsed;
  const expanded = narrow ? mobileOpen : !navigationCollapsed;
  function toggleNavigation() {
    if (narrow) {
      setMobileOpen((value) => !value);
    } else if (onCollapsedChange) {
      onCollapsedChange(!navigationCollapsed);
    } else {
      setInternalCollapsed(!navigationCollapsed);
    }
  }
  // A leave guard may keep this page open. Close the drawer only after a real destination change.
  useEffect(() => {
    let current = true;
    queueMicrotask(() => {
      if (current) {
        setMobileOpen(false);
      }
    });
    return () => {
      current = false;
    };
  }, [activeItem]);
  useEffect(() => {
    navigation.current
      ?.querySelector<HTMLElement>('[aria-current="page"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeItem]);
  function navigate(id: string) {
    onNavigate(id);
  }
  const frame = (
    <div className="wf-shell" data-collapsed={navigationCollapsed} data-mobile-open={mobileOpen}>
      <aside className="wf-sidebar" aria-label={t('access.navigation.menu')}>
        <div className="wf-logo wf-application-logo" aria-label="careiq">
          <span className="cq-a-wordmark" aria-hidden="true" />
          <span className="wf-application-symbol" aria-hidden="true">
            ✚
          </span>
        </div>
        <div className="wf-application-picker" inert={navigationDisabled}>
          {contextPicker ?? (
            <div className="wf-context">
              <strong>{practiceName ?? t('workflow.labels.yourPractice')}</strong>
              {locationName && <small>{locationName}</small>}
            </div>
          )}
        </div>
        <nav
          ref={navigation}
          id={navigationId}
          aria-label={navigationLabel ?? t('workflow.text.practiceNavigation')}
        >
          {items.map((item) => (
            <Fragment key={item.id}>
              {item.group && (
                <p className="wf-nav-group" aria-hidden="true">
                  {item.group}
                </p>
              )}
              <button
                type="button"
                title={item.label}
                aria-label={item.label}
                aria-current={activeItem === item.id ? 'page' : undefined}
                disabled={navigationDisabled}
                onClick={() => navigate(item.id)}
              >
                <span className="wf-nav-icon" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="wf-nav-label">{item.label}</span>
              </button>
            </Fragment>
          ))}
        </nav>
        <div className="wf-sidebar-foot" inert={navigationDisabled}>
          {footer}
          <p className="wf-application-motto">{t('access.copy.a_little_more_room_to_care')}</p>
          {account && (
            <div role="group" aria-label={t('access.copy.your_account')}>
              {account}
            </div>
          )}
        </div>
      </aside>
      <div className="wf-body">
        <header className="wf-topbar">
          <span className="wf-topbar-context">
            <button
              type="button"
              className="wf-nav-toggle"
              aria-label={t(`workflow.studio.${expanded ? 'collapseNav' : 'expandNav'}`)}
              aria-expanded={expanded}
              aria-controls={navigationId}
              disabled={navigationDisabled}
              onClick={toggleNavigation}
            >
              ☰
            </button>
            <span className="wf-mobile-wordmark cq-a-wordmark" aria-hidden="true" />
            <span className="wf-application-header-context">
              {pageLabel && !navigationCollapsed ? (
                pageLabel
              ) : (
                <>
                  {practiceName ?? t('workflow.labels.yourPractice')}
                  {locationName && (
                    <>
                      <span aria-hidden="true"> / </span>
                      <strong>{locationName}</strong>
                    </>
                  )}
                </>
              )}
            </span>
          </span>
          <div className="wf-topbar-tools">
            <span className="wf-application-tools" inert={navigationDisabled}>
              {tools}
            </span>
            <LanguageSelector />
          </div>
        </header>
        <main className="wf-main" data-cq-dialog-focus-fallback>
          {children}
        </main>
      </div>
    </div>
  );
  return embedded ? (
    frame
  ) : (
    <div className="wf-root cq-application-frame" lang={locale} dir={direction}>
      {frame}
    </div>
  );
}
