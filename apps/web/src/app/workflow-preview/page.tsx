import { notFound } from "next/navigation";
import { WorkflowPreview } from "@/components/workflow/WorkflowPreview";
import { designPreviewEnabled } from "@/lib/web-config";
export default function WorkflowPreviewPage() { if (!designPreviewEnabled(process.env.NODE_ENV)) notFound(); return <WorkflowPreview />; }
