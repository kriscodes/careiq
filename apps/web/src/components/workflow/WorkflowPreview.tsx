"use client";
import { useState } from "react";
import { createPreviewAdapter } from "./preview-adapter";
import { WorkflowWorkspace } from "./WorkflowWorkspace";
export function WorkflowPreview() { const [adapter] = useState(createPreviewAdapter); return <WorkflowWorkspace currentUserId="demo-staff" adapter={adapter} practiceName="Willow family practice" />; }
