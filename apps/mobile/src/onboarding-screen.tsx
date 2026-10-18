import { Text, View, useI18n } from "./i18n";
import { useClerk } from "@clerk/expo";
import { useQuery } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { BackHandler } from "react-native";
import { draftErrors, emptyDraft, onboardingPayload, type Draft, type OnboardingResult, type OnboardingState } from "./contracts";
import { useApiSession } from "./session";
import { canReviseSubmission } from "./access-policy";
import { styles } from "./styles";
import { Button, Feedback, Field, Note, Page, Progress, TextButton, TimeZoneField, Checkbox, zoneName } from "./ui";
export function OnboardingScreen() {
  const { t: tx, errorMessage } = useI18n();
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
  if (state.isError) return <Page title={tx("mobile.copy.we_couldn_t_check_your_setup_e7fde90")} onBack={() => router.replace("/")}><Feedback error={errorMessage(state.error)} /><Button onPress={() => void state.refetch()}>{tx("mobile.copy.try_again_042c862")}</Button></Page>;
  if (state.isPending) return <Page title={tx("mobile.copy.preparing_your_practice_setup_51e9b80")}>{null}</Page>;
  return <OnboardingForm key={scope} initial={state.data} refresh={state.refetch} />;
}
function OnboardingForm({
  initial,
  refresh
}: {
  initial: OnboardingState;
  refresh: () => Promise<unknown>;
}) {
  const { errorMessage, t: tx, locale } = useI18n();
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
    setSaved("mobile.copy.saving_progress_e0a4be1");
    const work = saves.current.catch(() => undefined).then(async () => {
      await api<Draft>("/api/v1/onboarding/draft", {
        method: "PUT",
        body: next
      });
      if (version.current === current) setSaved("mobile.copy.progress_saved_2d1d47f");
    });
    saves.current = work;
    return work;
  }, [api]);
  useEffect(() => {
    if (!started || locked || !state.data?.eligible || !state.data.emailVerified) return;
    const timer = setTimeout(() => {
      void save(draft).catch(e => {
        setSaved("");
        setError(errorMessage(e));
      });
    }, 700);
    return () => clearTimeout(timer);
  }, [draft, started, locked, state.data?.eligible, state.data?.emailVerified, save, errorMessage]);
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
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [busy, locked, draft, save, errorMessage]);
  const back = useCallback(() => {
    if (locked) router.replace("/");else if (started && draft.step > 1) void goStep(draft.step - 1 as 1 | 2);else {
      void save(draft).then(() => router.replace("/")).catch(e => setError(errorMessage(e)));
    }
  }, [locked, router, started, draft, goStep, save, errorMessage]);
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
      setError("mobile.copy.confirm_that_you_re_authorized_to_create_and_adminis_14aaf81");
      return;
    }
    const errors = draftErrors(draft);
    if (Object.keys(errors).length) {
      setValidation(errors);
      setError("mobile.copy.check_your_practice_and_location_details_before_cont_99ee30b");
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
      setError(errorMessage(e));
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
        setError(errorMessage(e));
      } finally {
        setBusy(false);
      }
    } else {
      void create();
    }
  };
  if (!state.data?.emailVerified) return <Page title={tx("mobile.copy.verify_your_email_first_6cd9fd4")} description={tx("mobile.copy.confirm_your_email_before_setting_up_a_practice_3152563")} onBack={() => router.replace("/")}><Button onPress={() => router.push("/security")}>{tx("mobile.copy.verify_your_email_84fdc78")}</Button><Button secondary onPress={() => void state.refetch()}>{tx("mobile.copy.check_again_e185048")}</Button></Page>;
  if (!state.data.eligible) return <Page title={tx("mobile.copy.practice_setup_needs_approval_220f52e")} description={tx("mobile.copy.your_account_is_ready_new_practices_are_enabled_for__44915af")} onBack={() => router.replace("/")}><Note>{tx("mobile.copy.if_you_were_invited_to_a_practice_use_your_invitatio_7437c16")}</Note><Button onPress={() => router.push("/join")}>{tx("mobile.copy.view_practice_invitations_6efe2ca")}</Button><Button secondary onPress={() => void state.refetch()}>{tx("mobile.copy.check_approval_again_f144a63")}</Button></Page>;
  if (locked) return <Page title={state.data.operation?.state === "complete" ? tx("mobile.copy.your_practice_is_ready_55f31d7") : tx("mobile.copy.finishing_your_setup_88970db")} description={tx("mobile.copy.your_submitted_details_have_been_saved_continue_with_9ab09ef")} onBack={() => router.replace("/")}><View style={styles.card}><Text style={styles.label}>{draft.practiceName}</Text><Text style={styles.note}>{draft.locationName} · {zoneName(draft.timeZone,locale)}</Text></View><Feedback error={error} /><Button busy={busy} onPress={() => void resume()}>{state.data.operation?.state === "complete" ? tx("mobile.copy.open_your_practice_e853407") : tx("mobile.copy.continue_setup_7a4e54c")}</Button><Button secondary onPress={() => void state.refetch()}>{tx("mobile.copy.check_status_07adf97")}</Button></Page>;
  if (!started) return <Page title={state.data.draft ? tx("mobile.copy.pick_up_where_you_left_off_f16c409") : tx("mobile.copy.let_s_set_up_your_practice_acf9bd6")} description={tx("mobile.copy.a_few_details_are_all_we_need_to_get_started_b6195c4")} onBack={() => router.replace("/")}><View style={styles.card}>{[tx("mobile.copy.1_name_your_practice_542ab60"), tx("mobile.copy.2_add_your_first_location_a481428"), tx("mobile.copy.3_review_and_create_1f0c941")].map(label => <Text key={label} style={styles.label}>{label}</Text>)}</View><Note>{tx("mobile.copy.your_progress_is_saved_to_your_account_you_can_conti_aec6736")}</Note><Button onPress={() => setStarted(true)}>{state.data.draft ? tx("mobile.copy.resume_setup_e799297") : tx("mobile.copy.start_practice_setup_8635e0c")}</Button></Page>;
  return <Page title={draft.step === 1 ? tx("mobile.copy.tell_us_about_your_practice_99f232e") : draft.step === 2 ? tx("mobile.copy.add_your_first_location_80081ab") : tx("mobile.copy.everything_look_right_93400a9")} description={draft.step === 1 ? tx("mobile.copy.use_the_name_your_team_knows_0a67d23") : draft.step === 2 ? tx("mobile.copy.your_location_keeps_scheduling_and_access_organized_5de7096") : tx("mobile.copy.you_ll_be_the_practice_owner_you_can_invite_your_tea_c8572f9")} onBack={back}><Progress step={draft.step} />
    {draft.step === 1 && <Field label={tx("mobile.copy.practice_name_d810f16")} value={draft.practiceName} onChangeText={value => change("practiceName", value)} error={validation.practiceName} placeholder="Marlow Family Practice" maxLength={120} autoCapitalize="words" />}
    {draft.step === 2 && <><Field label={tx("mobile.copy.location_name_9cac358")} value={draft.locationName} onChangeText={value => change("locationName", value)} error={validation.locationName} maxLength={120} placeholder={tx("mobile.copy.main_location_d65e1a6")} autoCapitalize="words" /><TimeZoneField value={draft.timeZone} onChange={value => change("timeZone", value)} error={validation.timeZone} /><Field label={tx("mobile.copy.address_optional_d18fd0c")} value={draft.address} onChangeText={value => change("address", value)} error={validation.address} placeholder={tx("mobile.copy.street_address_city_state_zip_781c067")} maxLength={500} autoComplete="street-address" /></>}
    {draft.step === 3 && <View style={styles.card}>{[[tx("mobile.copy.practice_3e15ac7"), draft.practiceName], [tx("mobile.copy.first_location_d1d4112"), draft.locationName], [tx("mobile.copy.time_zone_eea79af"), zoneName(draft.timeZone,locale)], [tx("mobile.copy.address_d70f93d"), draft.address || tx("mobile.copy.not_added_a565165")]].map(([label, value]) => <View key={label} style={styles.summary}><Text style={styles.note}>{label}</Text><Text style={styles.label}>{value}</Text></View>)}<TextButton onPress={() => void goStep(1)}>{tx("mobile.copy.edit_practice_details_a355168")}</TextButton><TextButton onPress={() => void goStep(2)}>{tx("mobile.copy.edit_location_3c692a6")}</TextButton></View>}
    <Feedback error={error} message={saved} />{draft.step === 3 && <Checkbox label={tx("mobile.copy.i_confirm_i_m_authorized_to_create_and_administer_th_beae33b")} checked={authority} onChange={setAuthority} />}<Button disabled={draft.step === 3 && !authority} busy={busy} onPress={draft.step === 3 ? () => void create() : next}>{draft.step === 3 ? tx("mobile.copy.create_practice_ac4f718") : tx("mobile.copy.continue_2e02623")}</Button><TextButton disabled={busy} onPress={() => {
      setBusy(true);
      void save(draft).then(() => router.replace("/")).catch(e => setError(errorMessage(e))).finally(() => setBusy(false));
    }}>{tx("mobile.copy.save_and_finish_later_77cffe3")}</TextButton>{draft.step === 3 && <Note>{tx("mobile.copy.creating_a_location_does_not_automatically_give_anyo_d0321eb")}</Note>}
  </Page>;
}
