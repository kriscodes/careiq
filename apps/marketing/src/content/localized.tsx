"use client";
import { useI18n } from "../../../web/src/i18n/provider";
import { content, validateContent, type SiteContent } from "./content";
import spanish from "./site-content.es.json";
const es=validateContent(spanish satisfies SiteContent);
export function useSiteContent():SiteContent { return useI18n().locale === "es" ? es : content; }
