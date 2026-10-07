import type { TenantContext } from "../middleware/tenant-context.js";
import type { ClinicalCapabilities } from "../middleware/permissions.js";

declare global {
  namespace Express {
    interface Locals {
      tenant: TenantContext;
      capabilities: ClinicalCapabilities;
    }
  }
}

export {};
