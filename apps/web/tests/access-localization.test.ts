import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { catalogs, translate } from "../../../packages/i18n";
import { I18nProvider } from "../src/i18n/provider";
import { AccessPassword, AccessShell } from "../src/components/access/AccessShell";
import { accessAuditLabel, accessRoleLabel, accessStatusLabel, localizeAccessText } from "../src/components/access/display";
import { authErrorMessage } from "../src/lib/auth-errors";

const spanish = (key: string, values?: Record<string, string | number>) => translate("es", key, values);

test("Spanish account controls retain password-manager and accessible progress semantics", () => {
  const shell = createElement(AccessShell, { step: 2 } as Parameters<typeof AccessShell>[0], createElement(AccessPassword));
  const markup = renderToStaticMarkup(createElement(I18nProvider, { initialLocale: "es", scope: "staff" } as Parameters<typeof I18nProvider>[0], shell));
  assert.match(markup, /aria-label="Mostrar contraseña"/);
  assert.match(markup, /autoComplete="current-password"/i);
  assert.match(markup, /aria-label="Configuración de la clínica: paso 2 de 3"/);
  assert.match(markup, /Paso 2 de 3/);
  assert.match(markup, /¿Te echamos una mano\?/);
  assert.doesNotMatch(markup, /Need help|Your practice|Enter your password/);
});

test("provider errors localize by safe code without exposing provider diagnostics or account existence", () => {
  const missing = authErrorMessage({ errors: [{ code: "form_identifier_not_found", message: "secret account details" }] }, spanish);
  assert.equal(missing, "El correo o la contraseña no son correctos. Inténtalo de nuevo.");
  assert.equal(missing, authErrorMessage({ code: "form_password_incorrect" }, spanish));
  assert.doesNotMatch(authErrorMessage({ code: "unexpected_provider_error", message: "token=private" }, spanish), /private|token|unexpected_provider_error/);
});

test("visible fixed notifications can change language while preserving interpolated values", () => {
  const email = "synthetic+review@example.test";
  const englishMessage = translate("en", "access.invitation.verifyEmail", { email });
  const spanishMessage = localizeAccessText(spanish, englishMessage);
  assert.equal(spanishMessage, spanish("access.invitation.verifyEmail", { email }));
  assert.equal(localizeAccessText((key, values) => translate("en", key, values), spanishMessage), englishMessage);
  assert.equal(localizeAccessText(spanish, "Untranslated authored patient content"), "Untranslated authored patient content");
});

test("role, audit and status labels translate while canonical codes remain stable", () => {
  assert.equal(accessRoleLabel(spanish, "org:admin"), "Administrador");
  assert.equal(accessRoleLabel(spanish, "org:custom_clinician"), "Rol personalizado · org:custom_clinician");
  assert.equal(accessStatusLabel(spanish, "confirmed"), "Confirmada");
  assert.equal(accessStatusLabel(spanish, "pending_assignment"), "Pendiente de asignación");
  assert.equal(accessAuditLabel(spanish, "action", "documents.review"), "Revisar documento");
  assert.equal(accessAuditLabel(spanish, "action", "future.code"), "Acción de auditoría");
  assert.equal(accessStatusLabel(spanish, undefined), translate("es", "common.unknownLabel"));
});

test("access catalogs are complete and pluralized messages keep their sentence structure", () => {
  const enKeys = Object.keys(catalogs.en).filter(key => key.startsWith("access.")).sort();
  const esKeys = Object.keys(catalogs.es).filter(key => key.startsWith("access.")).sort();
  assert.deepEqual(esKeys, enKeys);
  assert.equal(spanish("access.workspace.appointmentCount", { count: 1 }), "1 cita");
  assert.equal(spanish("access.workspace.appointmentCount", { count: 3 }), "3 citas");
  for (const key of enKeys) assert.ok(catalogs.es[key].trim(), key);
});
