import { useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "../../../src/i18n/provider";
import { WorkflowWorkspace } from "../../../src/components/workflow/WorkflowWorkspace";
import { createPreviewAdapter } from "../../../src/components/workflow/preview-adapter";
import { createCommunicationsAdapter } from "../../../src/lib/api/communications";
const locationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function Harness() {
  const [adapter] = useState(() => { const preview = createPreviewAdapter(); const load = preview.load.bind(preview); preview.load = async (...args) => { const snapshot = await load(...args); return new URLSearchParams(location.search).has("readonly") ? { ...snapshot, capabilities: { patientsRead: true, documentsRead: true, appointmentsRead: true } } : snapshot; }; return preview; });
  const [communicationsAdapter] = useState(() => createCommunicationsAdapter(locationId, async () => "synthetic-browser-test-token", () => { document.documentElement.dataset.accessDenied = "true"; }));
  return <WorkflowWorkspace adapter={adapter} communicationsAdapter={communicationsAdapter} practiceName="Synthetic practice" />;
}
createRoot(document.getElementById("root")!).render(<I18nProvider scope="staff"><Harness /></I18nProvider>);
