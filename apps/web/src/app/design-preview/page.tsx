import { notFound } from "next/navigation";
import { designPreviewEnabled } from "@/lib/web-config";
import { DesignPreviewView } from "@/components/access/DesignPreviewView";
export const metadata = { title: "CareIQ", robots: { index: false, follow: false } };
export default function DesignPreview() { if (!designPreviewEnabled(process.env.NODE_ENV)) notFound(); return <DesignPreviewView />; }
