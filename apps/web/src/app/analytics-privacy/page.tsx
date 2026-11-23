import Link from 'next/link';
import { requestLocale } from '@/i18n/server';
import { AccessHeading, AccessShell } from '@/components/access/AccessShell';
import { AnalyticsPreference } from './AnalyticsPreference';
import { studioInsightsConfiguredOrigin } from '../../../../../packages/studio-insights/collector';

const content = {
  en: {
    title: 'Analytics preferences',
    summary:
      'When enabled, Studio Insights counts visits to the app entry page using a random browser ID that changes daily. CareIQ sends no patient records, account identifiers, or workflow activity.',
    excluded: 'Your browser is excluded from CareIQ Web analytics.',
    included: 'Your browser allows CareIQ Web analytics.',
    browserBlocked: 'Your browser’s privacy setting blocks CareIQ Web analytics.',
    exclude: 'Exclude my visits',
    include: 'Allow analytics',
    disabled: 'Analytics is disabled for this deployment.',
    back: 'Back to CareIQ',
  },
  es: {
    title: 'Preferencias de analítica',
    summary:
      'Cuando está habilitado, Studio Insights cuenta las visitas a la página de entrada mediante un identificador aleatorio del navegador que cambia cada día. CareIQ no envía expedientes de pacientes, identificadores de cuentas ni actividad de los flujos de trabajo.',
    excluded: 'Tu navegador está excluido de la analítica de CareIQ Web.',
    included: 'Tu navegador permite la analítica de CareIQ Web.',
    browserBlocked:
      'La configuración de privacidad de tu navegador bloquea la analítica de CareIQ Web.',
    exclude: 'Excluir mis visitas',
    include: 'Permitir la analítica',
    disabled: 'La analítica está deshabilitada en este entorno.',
    back: 'Volver a CareIQ',
  },
};

export default async function AnalyticsPrivacy() {
  const locale = await requestLocale();
  const copy = locale === 'es' ? content.es : content.en;
  return (
    <AccessShell centered showAnalyticsPreference={false}>
      <AccessHeading title={copy.title} />
      <p>{copy.summary}</p>
      {studioInsightsConfiguredOrigin() ? (
        <AnalyticsPreference copy={copy} />
      ) : (
        <p>{copy.disabled}</p>
      )}
      <Link href="/">{copy.back}</Link>
    </AccessShell>
  );
}
