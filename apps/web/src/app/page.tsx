import {
  SignInButton,
  SignUpButton,
  Show,
  UserButton,
} from "@clerk/nextjs";
import { Patients } from "@/components/Patients";
import { Appointments } from "@/components/Appointments";

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
      </div>
      <Patients/>
      <Appointments/>

    </main>
  );
}