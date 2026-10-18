"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useI18n } from "./provider";
/** Refresh server-owned metadata and Clerk dictionaries without replacing client state. */
export function LocaleRefresh() {
  const {locale}=useI18n();
  const previous=useRef(locale);
  const router=useRouter();
  useEffect(()=>{if(previous.current!==locale){previous.current=locale;router.refresh();}},[locale,router]);
  return null;
}
