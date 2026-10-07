import { OnboardingScreen } from "../src/onboarding-screen";
import { Protected } from "../src/session";
export default function Screen() {
  return <Protected><OnboardingScreen /></Protected>;
}
