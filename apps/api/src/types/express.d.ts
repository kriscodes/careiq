import type { TenantContext } from "../middleware/tenant-context.js";

declare global {
    namespace Express {
        interface Locals {
            tenant: TenantContext;
        }
    }
}

export {};