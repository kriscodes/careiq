import { JoinScreen } from "../src/access-screen";
import { Protected } from "../src/session";
export default function Screen() {
  return <Protected><JoinScreen /></Protected>;
}
