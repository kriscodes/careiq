import { TeamScreen } from "../src/team-screen";
import { Protected } from "../src/session";
export default function Screen() {
  return <Protected><TeamScreen /></Protected>;
}
