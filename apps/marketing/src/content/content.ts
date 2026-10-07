import rawContent from "./site-content.json";
import { INTERVIEW_ROLES, type InterviewRole } from "@careiq/interview-contract";

type TextFields<T extends string> = Record<T, string>;
type Description = { title: string; description: string };
type ValidationMessages = TextFields<"required" | "invalid" | "too_long">;
export type FormField = "name" | "email" | "role" | "practiceName";
export interface SiteContent {
  brand: TextFields<"product" | "business" | "homeLabel">;
  navigation: TextFields<"focus" | "founder" | "faq" | "cta" | "application" | "openMenu" | "closeMenu" | "label" | "skip">;
  hero: TextFields<"eyebrow" | "headline" | "description" | "supporting" | "primaryCta" | "secondaryCta" | "stageNote">;
  workflow: TextFields<"eyebrow" | "heading" | "description" | "caption"> & { steps: Description[] };
  focus: TextFields<"eyebrow" | "heading" | "description" | "note"> & { cards: (Description & { question: string })[] };
  founder: TextFields<"eyebrow" | "heading" | "background" | "description" | "closing" | "name" | "role" | "linkedin">;
  interview: TextFields<"eyebrow" | "heading" | "description" | "boundary"> & { details: Description[] };
  form: TextFields<"heading" | "description" | "requiredNote" | "javascriptRequired" | "rolePlaceholder" | "emailHelp" | "patientWarning" | "privacyPrefix" | "privacyLink" | "privacySuffix" | "submit" | "submitting" | "retry" | "successHeading" | "success" | "successDetail" | "error" | "rateLimited" | "unavailable" | "validationSummary"> & {
    labels: TextFields<FormField | "optional" | "website">;
    roleLabels: Record<InterviewRole, string>;
    validation: Record<FormField, ValidationMessages>;
  };
  faq: TextFields<"eyebrow" | "heading"> & { items: { question: string; answer: string }[] };
  footer: TextFields<"description" | "stage" | "privacy" | "contact" | "copyright">;
  seo: TextFields<"homeTitle" | "homeDescription" | "privacyTitle" | "privacyDescription" | "notFoundTitle">;
  privacy: TextFields<"eyebrow" | "heading" | "versionLabel" | "intro" | "contactHeading" | "contactText" | "contactUnavailable" | "back"> & { sections: { heading: string; paragraphs: string[] }[] };
  notFound: TextFields<"eyebrow" | "heading" | "description" | "cta">;
}

// JSON's inferred shape is checked against this explicit contract by TypeScript.
// Runtime validation also rejects blank copy or empty collections at build time.
export function validateContent(value: SiteContent): SiteContent {
  function visit(node: unknown, path: string): void {
    if (typeof node === "string") {
      if (!node.trim()) throw new Error(`Site content ${path} must not be blank`);
      return;
    }
    if (Array.isArray(node)) {
      if (!node.length) throw new Error(`Site content ${path} must not be empty`);
      node.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, item] of Object.entries(node)) visit(item, `${path}.${key}`);
      return;
    }
    throw new Error(`Invalid site content at ${path}`);
  }
  visit(value, "content");
  if (value.workflow.steps.length !== 4 || value.focus.cards.length !== 3) {
    throw new Error("The current layout requires four workflow steps and three focus cards");
  }
  for (const role of INTERVIEW_ROLES) {
    if (!value.form.roleLabels[role]?.trim()) throw new Error(`Missing label for role ${role}`);
  }
  return value;
}

export const content = validateContent(rawContent satisfies SiteContent);
