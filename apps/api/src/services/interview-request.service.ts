import { PRIVACY_NOTICE_VERSION, type InterviewRequest } from "@careiq/interview-contract";
import { db } from "../db/client.js";
import { marketingInterviewRequests } from "../db/schema/marketing-interview-requests.js";

export async function createInterviewRequest(input: InterviewRequest): Promise<void> {
  // One autocommitted statement: resolving means the insert or conflict has
  // completed. No tenant scope, clinical audit write, or contact-data read.
  await db.insert(marketingInterviewRequests).values({
    name: input.name,
    email: input.email,
    role: input.role,
    practiceName: input.practiceName ?? null,
    submissionKey: input.submissionKey,
    source: "marketing_homepage",
    privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
  }).onConflictDoNothing({ target: marketingInterviewRequests.submissionKey });
}
