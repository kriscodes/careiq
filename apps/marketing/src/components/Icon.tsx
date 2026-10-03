// Small, local copy of CareIQ's existing stroke icons; no app-to-app imports.
const paths = {
  calendar: ["M5 5h14v15H5z", "M8 3v4m8-4v4M5 10h14"],
  users: ["M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6", "M3 20v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6m1 3a5 5 0 0 1 3 4v2"],
  "user-plus": ["M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6", "M3 20v-2a6 6 0 0 1 12 0v2M19 7v6m-3-3h6"],
  arrow: ["M5 12h14m-5-5 5 5-5 5"],
  mail: ["M3 5h18v14H3z", "m3 6 9 7 9-7"],
  clock: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18", "M12 7v5l3 2"],
  workflow: ["M3 3h6v6H3zM15 15h6v6h-6zM6 9v9h9M15 3h6v6h-6zM9 6h6"],
  check: ["m5 12 4 4L19 6"],
};
export type IconName = keyof typeof paths;
export function Icon({ name }: { name: IconName }) {
  return <svg className="cq-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name].map((d, index) => <path key={index} d={d} />)}</svg>;
}
