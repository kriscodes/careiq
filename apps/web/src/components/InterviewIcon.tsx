import type { CSSProperties } from "react";

export type InterviewIconName = "calendar" | "users" | "plus" | "user-plus" | "arrow" | "chevron-left" | "chevron-right" | "phone" | "mail" | "clock" | "building" | "code" | "workflow" | "check" | "home" | "file" | "settings" | "bell" | "shield" | "chart";
const paths: Record<InterviewIconName, string[]> = {
  home: ["m3 10 9-7 9 7", "M5 9v12h14V9M9 21v-7h6v7"],
  file: ["M6 3h8l4 4v14H6z", "M14 3v5h4M9 12h6m-6 4h6"],
  settings: ["M9 4h6l1 3 3 1 1 6-3 2-1 4H8l-1-3-3-2V9l3-1z", "M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0"],
  bell: ["M5 17h14l-2-3V9a5 5 0 0 0-10 0v5z", "M10 21h4M12 2v2"],
  shield: ["m12 3 8 3v6c0 5-5 8-8 10-3-2-8-5-8-10V6z", "m8 12 3 3 5-6"],
  chart: ["M4 3v18h17", "M8 16v-5m5 5V6m5 10v-7"],
  calendar: ["M5 5h14v15H5z", "M8 3v4m8-4v4M5 10h14"],
  users: ["M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6", "M3 20v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6m1 3a5 5 0 0 1 3 4v2"],
  plus: ["M12 5v14M5 12h14"],
  "user-plus": ["M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6", "M3 20v-2a6 6 0 0 1 12 0v2M19 7v6m-3-3h6"],
  arrow: ["M5 12h14m-5-5 5 5-5 5"],
  "chevron-left": ["m14 6-6 6 6 6"],
  "chevron-right": ["m9 6 6 6-6 6"],
  phone: ["M8 3H4v4c0 7 6 13 13 13h3v-4l-5-2-2 2a12 12 0 0 1-5-5l2-2z"],
  mail: ["M3 5h18v14H3z", "m3 6 9 7 9-7"],
  clock: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18", "M12 7v5l3 2"],
  building: ["M5 21V3h14v18M3 21h18M9 7h1m4 0h1M9 11h1m4 0h1M10 21v-5h4v5"],
  code: ["m8 6-6 6 6 6m8-12 6 6-6 6m-3-14-2 16"],
  workflow: ["M3 3h6v6H3zM15 15h6v6h-6zM6 9v9h9M15 3h6v6h-6zM9 6h6"],
  check: ["m5 12 4 4L19 6"],
};
export function InterviewIcon({ name, style }: { name: InterviewIconName; style?: CSSProperties }) {
  return <svg className="cq-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={style}>{paths[name].map((d, index) => <path key={index} d={d} />)}</svg>;
}
