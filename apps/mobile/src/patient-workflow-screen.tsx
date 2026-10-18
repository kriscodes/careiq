import { Text, View, useI18n, NativeCopyError } from "./i18n";
import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import * as Linking from "expo-linking";
import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";
import { ApiError } from "./api";
import { configuration } from "./environment";
import { Button, Checkbox, Feedback, Field, Note, Page } from "./ui";
import { createPatientSessionInitializer } from "./patient-session";
import { styles } from "./styles";

type Item = { id: string; requirementId: string; label?: string; labelSnapshot?: string; state?: string };
type PatientRequest = { id: string; purpose: string; state: string; recipientName?: string; items: Item[]; signature?: { revision: number; sourceSha256: string; consentText: string; consentTextVersion: string; fields: { key: string; type: string; required?: boolean; label?: string }[] } };
export function PatientWorkflowScreen() {
  const { t: tx, errorMessage } = useI18n();
  const url = Linking.useLinkingURL();
  const [request, setRequest] = useState<PatientRequest | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState(false);
  const [consent, setConsent] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [received, setReceived] = useState<string[]>([]);
  const live = useRef(true);
  const initializer = useRef<ReturnType<typeof createPatientSessionInitializer<PatientRequest>> | null>(null);
  const mutationLock = useRef(false);
  const scopeGeneration = useRef(0);
  const exchangeControllers = useRef(new Set<AbortController>());
  const controllers = useRef(new Set<AbortController>());
  const keys = useRef(new Map<string, string>());
  const uploads = useRef(new Map<string, { id: string; uploaded: boolean }>());
  const base = `${configuration.apiUrl || ""}/api/v1/patient-workflows`;
  async function call<T>(path: string, body?: unknown, binary?: ArrayBuffer, signal?: AbortSignal): Promise<T> {
    if (!configuration.apiUrl) throw new NativeCopyError("mobile.copy.your_care_team_s_secure_connection_is_not_configured_9c7f23c");
    const generation = scopeGeneration.current; const controller = new AbortController(); const ownedControllers = path === "session-exchanges" ? exchangeControllers.current : controllers.current; ownedControllers.add(controller); const abort = () => controller.abort(); if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
    const fingerprint = JSON.stringify([path, body, binary ? binary.byteLength : null]);
    if (body !== undefined && !keys.current.has(fingerprint)) keys.current.set(fingerprint, Crypto.randomUUID());
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(`${base}/${path}`, { method: binary ? "PUT" : body === undefined ? "GET" : "POST", credentials: "include", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", signal: controller.signal, headers: { "Content-Type": binary ? "application/octet-stream" : "application/json", ...(body !== undefined ? { "Idempotency-Key": keys.current.get(fingerprint)! } : {}) }, ...(binary ? { body: binary } : body === undefined ? {} : { body: JSON.stringify(body) }) });
      const payload = await response.json().catch(() => null) as { data?: T; error?: { code?: string; message?: string } } | null;
      if (!response.ok) { if ([401, 403, 404, 410].includes(response.status) && live.current && generation === scopeGeneration.current) { setRequest(null); setValues({}); setConsent(false); setOpened(false); } throw new ApiError(payload?.error?.code || "REQUEST_UNAVAILABLE", response.status, "", body!==undefined||binary?"idempotentWrite":"read"); }
      if (!live.current || controller.signal.aborted || path !== "session-exchanges" && generation !== scopeGeneration.current) throw new NativeCopyError("mobile.copy.this_form_was_closed_open_your_secure_link_again_fb64e31");
      if (body !== undefined) keys.current.delete(fingerprint);
      if (!payload?.data) throw new NativeCopyError("mobile.copy.the_secure_service_returned_an_incomplete_response_p_6572db2"); return payload.data as T;
    } catch(cause) { if(cause instanceof TypeError || cause instanceof Error && cause.name === "AbortError") throw new ApiError("NETWORK_ERROR",0,"",body!==undefined||binary?"idempotentWrite":"read"); throw cause; } finally { clearTimeout(timeout); ownedControllers.delete(controller); signal?.removeEventListener("abort", abort); }
  }
  useEffect(() => { live.current = true; const current = controllers.current; const exchanges = exchangeControllers.current; return () => { live.current = false; current.forEach(controller => controller.abort()); exchanges.forEach(controller => controller.abort()); current.clear(); exchanges.clear(); }; }, []);
  useEffect(() => {
    const controller = new AbortController(); const currentRequests = controllers.current; scopeGeneration.current += 1;
    const timer = setTimeout(() => { setLoading(true); setBusy(false); mutationLock.current = false; keys.current.clear(); uploads.current.clear(); setRequest(null); setError(""); setValues({}); setConsent(false); setOpened(false); setCompleted(false); setReceived([]); setDeclining(false);
      if (!initializer.current) initializer.current = createPatientSessionInitializer<PatientRequest>(token => call("session-exchanges", { token }), signal => call<PatientRequest>("request", undefined, undefined, signal));
      const cleanWebLink = () => { if (Platform.OS === "web" && globalThis.location?.hash) globalThis.history.replaceState(null,"",globalThis.location.pathname); }; if (url) cleanWebLink(); const readInitialURL = async () => { const initial = await Linking.getInitialURL(); cleanWebLink(); return initial; };
      void initializer.current(url, readInitialURL, controller.signal).then(data => { if (live.current && !controller.signal.aborted) { if (Platform.OS === "web" && globalThis.location?.hash) globalThis.history.replaceState(null,"",globalThis.location.pathname); setRequest(data); } }).catch(cause => { if (live.current && !controller.signal.aborted) setError(errorMessage(cause)); }).finally(() => { if (live.current && !controller.signal.aborted) setLoading(false); });
    }, 0);
    return () => { clearTimeout(timer); controller.abort(); currentRequests.forEach(request => request.abort()); currentRequests.clear(); };
    // The initializer shares one exchange promise across repeated URL notifications and StrictMode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  async function perform(work: () => Promise<void>) {
    if (mutationLock.current) return;
    const generation = scopeGeneration.current; mutationLock.current = true; setBusy(true); setError("");
    try { await work(); } catch (cause) { if (live.current && generation === scopeGeneration.current) setError(errorMessage(cause)); }
    finally { mutationLock.current = false; if (live.current && generation === scopeGeneration.current) setBusy(false); }
  }
  async function openFrozenDocument() {
    const generation = scopeGeneration.current; const controller = new AbortController(); controllers.current.add(controller); const timer = setTimeout(() => controller.abort(),30000);
    try {
      const response = await fetch(`${base}/document`, { credentials: "include", cache: "no-store", redirect: "error", signal: controller.signal });
      if (!response.ok) throw new NativeCopyError("mobile.copy.the_document_could_not_be_opened_contact_your_care_t_39eb717");
      if (!response.headers.get("Content-Type")?.includes("application/pdf")) throw new NativeCopyError("mobile.copy.the_document_could_not_be_verified_contact_your_care_ce9c367"); const bytes = await response.arrayBuffer();
      if (!live.current || controller.signal.aborted) return;
      if (Platform.OS === "web") { const objectUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })); globalThis.open(objectUrl, "_blank", "noopener,noreferrer"); setTimeout(() => URL.revokeObjectURL(objectUrl), 60000); }
      else { const file = new File(Paths.cache, `careiq-review-${Crypto.randomUUID()}.pdf`); try { file.write(new Uint8Array(bytes)); await Sharing.shareAsync(file.uri, { mimeType: "application/pdf", dialogTitle: tx("mobile.copy.review_your_document_3f2dd62") }); } finally { if (file.exists) file.delete(); } }
      if (live.current && generation === scopeGeneration.current) setOpened(true);
    } finally { clearTimeout(timer); controllers.current.delete(controller); }
  }
  async function upload(item: Item) {
    const picked = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "image/jpeg", "image/png"], multiple: false, copyToCacheDirectory: true });
    if (picked.canceled) return;
    const asset = picked.assets[0];
    if (!asset.size || asset.size > 10 * 1024 * 1024) throw new NativeCopyError("mobile.copy.choose_a_pdf_jpeg_or_png_up_to_10_mb_e26dd3b");
    const file = Platform.OS === "web" ? null : new File(asset.uri);
    let bytes: ArrayBuffer;
    try { if (Platform.OS === "web") { if (!asset.file) throw new NativeCopyError("mobile.copy.this_browser_could_not_read_the_selected_file_12442bd"); bytes = await asset.file.arrayBuffer(); } else { bytes = Uint8Array.from(await file!.bytes()).buffer; } }
    finally { if (file?.exists) file.delete(); }
    const hash = Array.from(new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes))).map(v => v.toString(16).padStart(2, "0")).join("");
    const identity = `${item.id}:${hash}`;
    let reserved = uploads.current.get(identity);
    if (!reserved) { const created = await call<{ uploadSessionId: string }>("uploads", { requirementId: item.requirementId, file: { name: asset.name, contentType: asset.mimeType || "application/octet-stream", sizeBytes: bytes.byteLength, sha256: hash } }); reserved = { id: created.uploadSessionId, uploaded: false }; uploads.current.set(identity, reserved); }
    if (!reserved.uploaded) { await call(`uploads/${reserved.id}/content`, {}, bytes); reserved.uploaded = true; }
    const result = await call<{ state: string; failureCode?: string; requestState?: string }>(`uploads/${reserved.id}/completion`, { sha256: hash, sizeBytes: bytes.byteLength });
    if (result.state !== "available") throw new NativeCopyError("mobile.copy.your_file_is_retained_safely_while_validation_is_una_e6e61c0");
    uploads.current.delete(identity);
    if (live.current) { setReceived(current => [...current, item.id]); if (result.requestState === "completed") setRequest(current => current ? { ...current, state: "completed" } : current); }
  }
  if (loading) return <Page title={tx("mobile.copy.opening_your_secure_form_23be46c")}><Text style={styles.body}>{tx("mobile.copy.confirming_this_request_with_your_care_team_3ee15f1")}</Text></Page>;
  if (completed) return <Page title={tx("mobile.copy.thank_you_you_re_all_set_000a235")}><Note>{tx("mobile.copy.your_response_was_saved_your_care_team_will_review_t_b5b806f")}</Note></Page>;
  return <Page title={request?.signature ? tx("mobile.copy.review_and_sign_98ce112") : tx("mobile.copy.your_document_request_f4e9c13")} description={request?.recipientName ? tx("mobile.copy.prepared_for_value0_52628aa", { value0: request.recipientName }) : tx("mobile.copy.a_secure_request_from_your_care_team_b5c5e9f")}><Feedback error={error} />{request && (["completed", "declined", "cancelled", "expired"].includes(request.state) ? <Note>{tx("mobile.copy.this_request_is_value0_contact_your_care_team_if_you_45d2aef", { value0: tx(`mobile.status.${request.state}`) })}</Note> : <>
    {request.signature ? <><Button busy={busy} onPress={() => void perform(openFrozenDocument)}>{tx("mobile.copy.open_document_to_review_2077e31")}</Button><Note>{tx("mobile.signature.languageNote")}</Note><Note>{request.signature.consentText}</Note>{request.signature.fields.map(field => <Field key={field.key} label={field.type.includes("signature") ? tx("mobile.copy.type_your_full_name_as_your_signature_ed0c10c") : field.label || tx("mobile.signature.field")} value={values[field.key] || ""} onChangeText={value => setValues(current => ({ ...current, [field.key]: value }))} maxLength={200} editable={!busy} />)}<Checkbox label={tx("mobile.copy.i_have_reviewed_the_document_and_consent_to_use_an_e_c78784c")} checked={consent} onChange={setConsent} /><Button busy={busy} disabled={!opened || !consent || request.signature.fields.some(f => f.required && !values[f.key]?.trim())} onPress={() => void perform(async () => { const result = await call<{ state: string }>("completion", { expectedRevision: request.signature!.revision, sourceSha256: request.signature!.sourceSha256, consent: { accepted: true, textVersion: request.signature!.consentTextVersion }, fields: request.signature!.fields.map(f => ({ key: f.key, type: f.type, value: values[f.key] || "" })) }); if (result.state !== "completed") throw new NativeCopyError("mobile.copy.your_signature_is_not_complete_yet_contact_your_care_7a46a08"); if (live.current) { setCompleted(true); setValues({}); } })}>{tx("mobile.copy.sign_and_finish_24c8999")}</Button></> : <>{request.items.map(item => <View key={item.id} style={styles.card}><Text style={styles.label}>{item.label || item.labelSnapshot || tx("mobile.copy.required_document_52c7755")}</Text>{received.includes(item.id) || item.state === "fulfilled" ? <Note>{tx("mobile.copy.file_received_staff_review_remains_separate_b2fa386")}</Note> : <Button busy={busy} onPress={() => void perform(() => upload(item))}>{tx("mobile.copy.choose_and_upload_file_a8885e6")}</Button>}</View>)}<Text style={styles.note}>{tx("mobile.copy.pdf_jpeg_or_png_up_to_10_mb_your_care_team_reviews_e_e101472")}</Text></>}
    {declining ? <><Note>{tx("mobile.copy.declining_leaves_the_document_requirement_incomplete_187e8e2")}</Note><Button busy={busy} onPress={() => void perform(async () => { await call("decline", { reasonCode: "patient_declined" }); if (live.current) { setRequest(null); setError("mobile.copy.you_declined_this_request_contact_your_care_team_for_bc2788b"); } })}>{tx("mobile.copy.confirm_decline_b4b1b95")}</Button><Button secondary onPress={() => setDeclining(false)}>{tx("mobile.copy.keep_request_open_950dd05")}</Button></> : <Button secondary disabled={busy} onPress={() => setDeclining(true)}>{tx("mobile.copy.i_need_another_option_150b7f4")}</Button>}
  </>)}</Page>;
}
