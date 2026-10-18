"use client";

import { useUser } from "@clerk/nextjs";
import { useEffect } from "react";
import { useI18n } from "./provider";

/** UI preference metadata never participates in access control or clinical records. */
export function AccountLocaleBridge() {
  const {user,isLoaded}=useUser();
  const {registerAccount}=useI18n();
  const raw=user?.unsafeMetadata?.careiqLocale;
  useEffect(()=>{
    if(!isLoaded)return;
    registerAccount(typeof raw==="string"?raw:null,user?async locale=>{
      await user.update({unsafeMetadata:{...user.unsafeMetadata,careiqLocale:locale}});
    }:undefined,user?.id??null);
    return ()=>registerAccount();
  },[isLoaded,user,raw,registerAccount]);
  return null;
}
