import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { LocaleProvider } from "../src/i18n";
import { PatientWorkflowScreen } from "../src/patient-workflow-screen";
export default function PatientWorkflowPage() {
  const [active,setActive]=useState(true);
  useFocusEffect(useCallback(()=>{setActive(true);return()=>setActive(false);},[]));
  return <LocaleProvider scope="patient" active={active}><PatientWorkflowScreen /></LocaleProvider>;
}
