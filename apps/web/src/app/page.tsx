import {
  SignInButton,
  SignUpButton,
  Show,
  UserButton,
} from "@clerk/nextjs";
import { ApiTest } from "@/components/ApiTest"

export default function Home() {
  return (
    <main className="min-h-screen p-8">
      <div className="mx-auto flex max-w-6xl items-center justify-between">
        <h1 className="text-2xl font-semibold">CareIQ</h1>

        <div className="flex items-center gap-4">
          <Show when="signed-out">
            <SignInButton />
            <SignUpButton />
          </Show>

          <Show when="signed-in">
            <UserButton />
          </Show>
        </div>
        <ApiTest/>
      </div>
    </main>
  );
}