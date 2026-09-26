import { PracticeWorkspace } from "@/components/PracticeWorkspace";

export default function Home() {
  const interviewMode = process.env.NEXT_PUBLIC_INTERVIEW_MODE === "true" ||
    (process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_INTERVIEW_MODE !== "false");
  return <PracticeWorkspace interviewMode={interviewMode} />;
}
