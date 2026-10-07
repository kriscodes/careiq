import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BookingForm, PatientForm } from "../src/components/InterviewForms";
import { createSubmissionAttempt } from "../src/lib/submission-attempt";

const noAction = () => {};
const noSave = async () => {};

test("members see disabled clinical forms; administrators can enter records", () => {
  for (const canCreate of [false, true]) {
    const patient = renderToStaticMarkup(createElement(PatientForm, {
      canCreate, practiceName: "Synthetic practice", onSubmit: noSave,
      onCancel: noAction, onBusyChange: noAction,
    }));
    const booking = renderToStaticMarkup(createElement(BookingForm, {
      canCreate, canAddPatient: canCreate, patients: [{ id: "synthetic", practiceId: "practice", firstName: "Synthetic", lastName: "Patient", email: null, phone: null }],
      practiceName: "Synthetic practice", timeZone: "UTC", draft: { patientId: "synthetic", date: "2026-10-04", time: "09:00", reason: "" },
      submissionAttempt: createSubmissionAttempt(), onChange: noAction, onSubmit: noSave,
      onCancel: noAction, onAddPatient: noAction, onBusyChange: noAction,
    }));
    for (const markup of [patient, booking]) {
      if (canCreate) assert.doesNotMatch(markup, /<fieldset[^>]*disabled/);
      else assert.match(markup, /<fieldset[^>]*disabled/);
    }
    if (!canCreate) assert.match(booking, /<button[^>]*disabled[^>]*>\+ Add a new patient/);
  }
});
