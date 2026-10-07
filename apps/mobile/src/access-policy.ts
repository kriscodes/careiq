import { ApiError } from "./api";
export function isForeground(state: string): boolean {
  return state === "active";
}
const refusals = new Set(["ONBOARDING_NOT_ELIGIBLE", "VERIFIED_EMAIL_REQUIRED", "INVALID_PRACTICE", "INVALID_LOCATION", "INVALID_TIME_ZONE", "INVALID_ADDRESS", "IDEMPOTENCY_KEY_REQUIRED", "INVALID_REQUEST"]);
export function canReviseSubmission(error: unknown): boolean {
  return error instanceof ApiError && [400, 403].includes(error.status) && refusals.has(error.code);
}
export type AccessPhase = "ready" | "background" | "checking" | "error";
// An external store lets AppState hide private content and invalidate in-flight work synchronously.
export class AccessLifecycle {
  private revision = 0;
  private phase: AccessPhase;
  private verified = false;
  private listeners = new Set<() => void>();
  private controllers = new Set<AbortController>();
  constructor(initial: AccessPhase) {
    this.phase = initial;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => `${this.phase}:${this.revision}`;
  get generation() {
    return this.revision;
  }
  get hasFreshAccess() {
    return this.verified;
  }
  get foreground() {
    return this.phase !== "background";
  }
  private emit() {
    for (const listener of this.listeners) listener();
  }
  cancel() {
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
  }
  register = (controller: AbortController) => {
    if (!this.foreground) controller.abort();else this.controllers.add(controller);
    return () => {
      this.controllers.delete(controller);
    };
  };
  suspend() {
    this.verified = false;
    this.revision++;
    this.phase = "background";
    this.cancel();
    this.emit();
  }
  beginCheck() {
    // A newer check supersedes every request from the previous access generation.
    this.revision++;
    this.cancel();
    this.verified = false;
    this.phase = "checking";
    this.emit();
    return this.revision;
  }
  completeCheck(generation: number) {
    if (generation !== this.revision || this.phase !== "checking") return false;
    this.verified = true;
    this.phase = "ready";
    this.emit();
    return true;
  }
  withoutAuthentication() {
    this.revision++;
    this.cancel();
    this.verified = false;
    this.phase = "ready";
    this.emit();
  }
  failCheck(generation: number) {
    if (generation !== this.revision || this.phase !== "checking") return false;
    this.phase = "error";
    this.emit();
    return true;
  }
}
