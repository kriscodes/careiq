import { useClerk } from "@clerk/expo";
import { useQuery } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { BackHandler, Text, View } from "react-native";
import { userMessage } from "./api";
import { draftErrors, emptyDraft, onboardingPayload, type Draft, type OnboardingResult, type OnboardingState } from "./contracts";
import { useApiSession } from "./session";
import { canReviseSubmission } from "./access-policy";
import { styles } from "./styles";
import { Button, Feedback, Field, Note, Page, Progress, TextButton, TimeZoneField, Checkbox, zoneName } from "./ui";
export function OnboardingScreen() {
  const {
    api,
    scope
  } = useApiSession();
  const router = useRouter();
  const state = useQuery({
    queryKey: ["onboarding", scope],
    queryFn: ({
      signal
    }) => api<OnboardingState>("/api/v1/onboarding/state", {
      signal
    })
  });
  if (state.isError) return <Page title="We couldn’t check your setup" onBack={() => router.replace("/")}><Feedback error={userMessage(state.error)} /><Button onPress={() => void state.refetch()}>Try again</Button></Page>;
  if (state.isPending) return <Page title="Preparing your practice setup…">{null}</Page>;
  return <OnboardingForm key={scope} initial={state.data} refresh={state.refetch} />;
}
function OnboardingForm({
  initial,
  refresh
}: {
  initial: OnboardingState;
  refresh: () => Promise<unknown>;
}) {
  const {
    api
  } = useApiSession();
  const router = useRouter();
  const {
    setActive
  } = useClerk();
  const state = {
    data: initial,
    refetch: refresh
  };
  const [draft, setDraft] = useState<Draft>(() => initial.draft ?? emptyDraft());
  const [started, setStarted] = useState(false);
  const [authority, setAuthority] = useState(!!initial.operation);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [validation, setValidation] = useState<ReturnType<typeof draftErrors>>({});
  const [submitted, setSubmitted] = useState(!!initial.operation);
  const attempt = useRef<{
    key: string;
    payload: ReturnType<typeof onboardingPayload>;
  } | null>(null);
  const saves = useRef<Promise<void>>(Promise.resolve());
  const version = useRef(0);
  const locked = submitted || !!state.data?.operation;
  const save = useCallback((next: Draft) => {
    const current = ++version.current;
    setSaved("Saving progress…");
    const work = saves.current.catch(() => undefined).then(async () => {
      await api<Draft>("/api/v1/onboarding/draft", {
        method: "PUT",
        body: next
      });
      if (version.current === current) setSaved("Progress saved");
    });
    saves.current = work;
    return work;
  }, [api]);
  useEffect(() => {
    if (!started || locked || !state.data?.eligible || !state.data.emailVerified) return;
    const timer = setTimeout(() => {
      void save(draft).catch(e => {
        setSaved("");
        setError(userMessage(e));
      });
    }, 700);
    return () => clearTimeout(timer);
  }, [draft, started, locked, state.data?.eligible, state.data?.emailVerified, save]);
  const goStep = useCallback(async (step: 1 | 2 | 3) => {
    if (busy || locked) return;
    const next = {
      ...draft,
      step
    };
    setBusy(true);
    setError("");
    try {
      await save(next);
      setDraft(next);
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setBusy(false);
    }
  }, [busy, locked, draft, save]);
  const back = useCallback(() => {
    if (locked) router.replace("/");else if (started && draft.step > 1) void goStep(draft.step - 1 as 1 | 2);else {
      void save(draft).then(() => router.replace("/")).catch(e => setError(userMessage(e)));
    }
  }, [locked, router, started, draft, goStep, save]);
  const backRef = useRef(back);
  useLayoutEffect(() => {
    backRef.current = back;
  }, [back]);
  useFocusEffect(useCallback(() => {
    const event = BackHandler.addEventListener("hardwareBackPress", () => {
      backRef.current();
      return true;
    });
    return () => event.remove();
  }, []));
  const change = (key: keyof Draft, value: string) => {
    if (locked) return;
    setDraft(current => ({
      ...current,
      [key]: value
    }));
    setValidation({});
    setError("");
  };
  const next = () => {
    const errors = draftErrors(draft);
    const relevant = draft.step === 1 ? errors.practiceName : errors.locationName || errors.timeZone || errors.address;
    setValidation(errors);
    if (!relevant) void goStep(draft.step + 1 as 2 | 3);
  };
  const create = async () => {
    if (busy) return;
    if (!authority) {
      setError("Confirm that you’re authorized to create and administer this practice.");
      return;
    }
    const errors = draftErrors(draft);
    if (Object.keys(errors).length) {
      setValidation(errors);
      setError("Check your practice and location details before continuing.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await saves.current;
      if (!attempt.current) {
        attempt.current = {
          key: randomUUID(),
          payload: onboardingPayload(draft)
        };
        setSubmitted(true);
      }
      const result = await api<OnboardingResult>("/api/v1/onboarding", {
        method: "POST",
        body: attempt.current.payload,
        key: attempt.current.key
      });
      await setActive({
        organization: result.orgId
      });
      router.replace("/created");
    } catch (e) {
      if (canReviseSubmission(e)) {
        attempt.current = null;
        setSubmitted(false);
      }
      setError(userMessage(e));
      void state.refetch();
    } finally {
      setBusy(false);
    }
  };
  const resume = async () => {
    if (state.data?.operation?.state === "complete" && state.data.operation.organizationId) {
      setBusy(true);
      try {
        await setActive({
          organization: state.data.operation.organizationId
        });
        router.replace("/created");
      } catch (e) {
        setError(userMessage(e));
      } finally {
        setBusy(false);
      }
    } else {
      void create();
    }
  };
  if (!state.data?.emailVerified) return <Page title="Verify your email first" description="Confirm your email before setting up a practice." onBack={() => router.replace("/")}><Button onPress={() => router.push("/security")}>Verify your email</Button><Button secondary onPress={() => void state.refetch()}>Check again</Button></Page>;
  if (!state.data.eligible) return <Page title="Practice setup needs approval" description="Your account is ready. New practices are enabled for approved owners." onBack={() => router.replace("/")}><Note>If you were invited to a practice, use your invitation to join. For a new practice, contact the CareIQ team for setup access.</Note><Button onPress={() => router.push("/join")}>View practice invitations</Button><Button secondary onPress={() => void state.refetch()}>Check approval again</Button></Page>;
  if (locked) return <Page title={state.data.operation?.state === "complete" ? "Your practice is ready" : "Finishing your setup"} description="Your submitted details have been saved. Continue with these same details." onBack={() => router.replace("/")}><View style={styles.card}><Text style={styles.label}>{draft.practiceName}</Text><Text style={styles.note}>{draft.locationName} · {zoneName(draft.timeZone)}</Text></View><Feedback error={error} /><Button busy={busy} onPress={() => void resume()}>{state.data.operation?.state === "complete" ? "Open your practice" : "Continue setup"}</Button><Button secondary onPress={() => void state.refetch()}>Check status</Button></Page>;
  if (!started) return <Page title={state.data.draft ? "Pick up where you left off" : "Let’s set up your practice"} description="A few details are all we need to get started." onBack={() => router.replace("/")}><View style={styles.card}>{["1. Name your practice", "2. Add your first location", "3. Review and create"].map(label => <Text key={label} style={styles.label}>{label}</Text>)}</View><Note>Your progress is saved to your account. You can continue on another device.</Note><Button onPress={() => setStarted(true)}>{state.data.draft ? "Resume setup" : "Start practice setup"}</Button></Page>;
  return <Page title={draft.step === 1 ? "Tell us about your practice" : draft.step === 2 ? "Add your first location" : "Everything look right?"} description={draft.step === 1 ? "Use the name your team knows." : draft.step === 2 ? "Your location keeps scheduling and access organized." : "You’ll be the practice owner. You can invite your team after setup."} onBack={back}><Progress step={draft.step} />
    {draft.step === 1 && <Field label="Practice name" value={draft.practiceName} onChangeText={value => change("practiceName", value)} error={validation.practiceName} placeholder="Marlow Family Practice" maxLength={120} autoCapitalize="words" />}
    {draft.step === 2 && <><Field label="Location name" value={draft.locationName} onChangeText={value => change("locationName", value)} error={validation.locationName} maxLength={120} placeholder="Main location" autoCapitalize="words" /><TimeZoneField value={draft.timeZone} onChange={value => change("timeZone", value)} error={validation.timeZone} /><Field label="Address · optional" value={draft.address} onChangeText={value => change("address", value)} error={validation.address} placeholder="Street address, city, state, ZIP" maxLength={500} autoComplete="street-address" /></>}
    {draft.step === 3 && <View style={styles.card}>{[["Practice", draft.practiceName], ["First location", draft.locationName], ["Time zone", zoneName(draft.timeZone)], ["Address", draft.address || "Not added"]].map(([label, value]) => <View key={label} style={styles.summary}><Text style={styles.note}>{label}</Text><Text style={styles.label}>{value}</Text></View>)}<TextButton onPress={() => void goStep(1)}>Edit practice details</TextButton><TextButton onPress={() => void goStep(2)}>Edit location</TextButton></View>}
    <Feedback error={error} message={saved} />{draft.step === 3 && <Checkbox label="I confirm I’m authorized to create and administer this practice." checked={authority} onChange={setAuthority} />}<Button disabled={draft.step === 3 && !authority} busy={busy} onPress={draft.step === 3 ? () => void create() : next}>{draft.step === 3 ? "Create practice" : "Continue"}</Button><TextButton disabled={busy} onPress={() => {
      setBusy(true);
      void save(draft).then(() => router.replace("/")).catch(e => setError(userMessage(e))).finally(() => setBusy(false));
    }}>Save and finish later</TextButton>{draft.step === 3 && <Note>Creating a location does not automatically give anyone access to it. You’ll choose access after setup.</Note>}
  </Page>;
}
