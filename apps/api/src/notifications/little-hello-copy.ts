export const littleHelloCatalog = [
  {
    "id": "verify_email",
    "subject": "A little hello. Verify your email.",
    "preheader": "Your CareIQ verification code is inside.",
    "heading": "A little hello.",
    "body": [
      "Let’s make sure this email belongs to you. Enter this code in CareIQ to continue verifying your account."
    ],
    "securityFootnote": "Keep this code to yourself. If you didn’t start creating an account, you can ignore this email.",
    "audience": [
      "owner",
      "administrator",
      "member",
      "configured_staff",
      "patient"
    ],
    "cta": null,
    "code": true,
    "details": [],
    "existingFlow": true
  },
  {
    "id": "sign_in_code",
    "subject": "Your CareIQ sign-in code",
    "preheader": "One code to pick up where you left off.",
    "heading": "Hello again.",
    "body": [
      "Enter this code in CareIQ to finish signing in."
    ],
    "securityFootnote": "Use this code only in the CareIQ sign-in you started. If you didn’t try to sign in, do not share or use it.",
    "audience": [
      "owner",
      "administrator",
      "member",
      "configured_staff",
      "patient"
    ],
    "cta": null,
    "code": true,
    "details": [],
    "existingFlow": true
  },
  {
    "id": "password_reset_code",
    "subject": "Reset your CareIQ password",
    "preheader": "Here’s the code for the reset you requested.",
    "heading": "A fresh start.",
    "body": [
      "We received a request to reset your CareIQ password. Enter this code in CareIQ, then choose a new password."
    ],
    "securityFootnote": "Didn’t request this? You can ignore this email. Your password changes only after the reset is completed. Never share this code.",
    "audience": [
      "owner",
      "administrator",
      "member",
      "configured_staff",
      "patient"
    ],
    "cta": null,
    "code": true,
    "details": [],
    "existingFlow": true
  },
  {
    "id": "password_changed",
    "subject": "Your CareIQ password was changed",
    "preheader": "A quick confirmation for your account.",
    "heading": "Password updated.",
    "body": [
      "Your CareIQ password was changed.",
      "If this was you, you’re all set. If you didn’t make this change, open CareIQ directly and review your account security."
    ],
    "securityFootnote": "CareIQ will never ask for your password by email. Do not reply with account details.",
    "audience": [
      "owner",
      "administrator",
      "member",
      "configured_staff",
      "patient"
    ],
    "cta": "Review account security",
    "code": false,
    "details": [],
    "existingFlow": false
  },
  {
    "id": "new_sign_in",
    "subject": "A new sign-in to CareIQ",
    "preheader": "Check that this sign-in was yours.",
    "heading": "Was this you?",
    "body": [
      "A new sign-in was recorded for your CareIQ account.",
      "If you recognize it, there’s nothing else to do. If you don’t, open CareIQ directly to review your sessions and security settings."
    ],
    "securityFootnote": "Location is approximate when available. This email will never ask you to send a password or code.",
    "audience": [
      "owner",
      "administrator",
      "member",
      "configured_staff",
      "patient"
    ],
    "cta": "Review sign-in",
    "code": false,
    "details": [
      {
        "label": "Time",
        "value": "{{event_time}}"
      },
      {
        "label": "Device",
        "value": "{{device}}"
      },
      {
        "label": "Approximate location",
        "value": "{{approximate_location}}"
      }
    ],
    "existingFlow": false
  },
  {
    "id": "mfa_email_code",
    "subject": "Your CareIQ verification code",
    "preheader": "One more step to finish signing in.",
    "heading": "One more step.",
    "body": [
      "Enter this code in CareIQ to finish the two-step verification you started."
    ],
    "securityFootnote": "Keep this code to yourself. If you didn’t start this sign-in, don’t use or share it.",
    "audience": [
      "owner",
      "administrator",
      "member",
      "configured_staff",
      "patient"
    ],
    "cta": null,
    "code": true,
    "details": [],
    "existingFlow": true
  },
  {
    "id": "mfa_added",
    "subject": "Two-step verification was added",
    "preheader": "A security update for your CareIQ account.",
    "heading": "An extra layer, added.",
    "body": [
      "Two-step verification was added to your CareIQ account.",
      "If you made this change, you’re all set. If you didn’t, open CareIQ directly and review your account security."
    ],
    "securityFootnote": "Store saved recovery codes somewhere private. CareIQ won’t ask you to email them.",
    "audience": [
      "owner",
      "administrator",
      "member",
      "configured_staff",
      "patient"
    ],
    "cta": "Review account security",
    "code": false,
    "details": [],
    "existingFlow": false
  },
  {
    "id": "mfa_removed",
    "subject": "Two-step verification was removed",
    "preheader": "Please review this account change.",
    "heading": "A security change.",
    "body": [
      "A two-step verification method was removed from your CareIQ account.",
      "If you didn’t make this change, open CareIQ directly and review your account security."
    ],
    "securityFootnote": "Never share your password, verification codes, or saved recovery codes.",
    "audience": [
      "owner",
      "administrator",
      "member",
      "configured_staff",
      "patient"
    ],
    "cta": "Review account security",
    "code": false,
    "details": [],
    "existingFlow": false
  },
  {
    "id": "verify_new_email",
    "subject": "Verify your new CareIQ email",
    "preheader": "Confirm the address you want to use.",
    "heading": "New email. Same you.",
    "body": [
      "You asked to add this email address to your CareIQ account. Enter this code in CareIQ to verify it."
    ],
    "securityFootnote": "If you didn’t request this, don’t use or share the code. Email verification does not grant practice access.",
    "audience": [
      "owner",
      "administrator",
      "member",
      "configured_staff",
      "patient"
    ],
    "cta": null,
    "code": true,
    "details": [],
    "existingFlow": false
  },
  {
    "id": "email_change_requested_old",
    "subject": "An email change was requested for CareIQ",
    "preheader": "A quick notice to your current email.",
    "heading": "A change is in progress.",
    "body": [
      "A request was made to use {{new_masked_email}} with your CareIQ account.",
      "If you requested this, follow the verification steps sent to the new address. If you didn’t, open CareIQ directly to review your account security."
    ],
    "securityFootnote": "This message does not confirm that your sign-in email has changed.",
    "audience": [
      "owner",
      "administrator",
      "member",
      "configured_staff",
      "patient"
    ],
    "cta": "Review account security",
    "code": false,
    "details": [],
    "existingFlow": false
  },
  {
    "id": "email_changed",
    "subject": "Your CareIQ email was updated",
    "preheader": "A confirmation of your account change.",
    "heading": "Email updated.",
    "body": [
      "Your CareIQ account email was updated to {{new_masked_email}}.",
      "If you didn’t make this change, open CareIQ directly and review your account security."
    ],
    "securityFootnote": "Keep this notice for your records. CareIQ will never ask you to reply with a password or code.",
    "audience": [
      "owner",
      "administrator",
      "member",
      "configured_staff",
      "patient"
    ],
    "cta": "Review account security",
    "code": false,
    "details": [],
    "existingFlow": false
  },
  {
    "id": "team_invitation",
    "subject": "You’re invited to {{practice_name}}",
    "preheader": "A little hello from your new team.",
    "heading": "Your team says hello.",
    "body": [
      "{{inviter_name}} invited you to join {{practice_name}} in CareIQ.",
      "Accept with the email address that received this invitation. After you join, the practice owner will confirm your role and location access."
    ],
    "securityFootnote": "Only accept invitations from a practice you recognize. Accepting does not give access to patient records by itself.",
    "audience": [
      "administrator",
      "member",
      "configured_staff"
    ],
    "cta": "Accept invitation",
    "code": false,
    "details": [
      {
        "label": "Practice",
        "value": "{{practice_name}}"
      },
      {
        "label": "Invitation expires",
        "value": "{{expires_at}}"
      }
    ],
    "existingFlow": true,
    "roleDetail": true
  },
  {
    "id": "invitation_reminder",
    "subject": "Your invitation to {{practice_name}} is waiting",
    "preheader": "Join your team when you’re ready.",
    "heading": "A little nudge.",
    "body": [
      "You still have an invitation to join {{practice_name}} in CareIQ.",
      "Accept with the email address that received your invitation. The practice owner will confirm your access after you join."
    ],
    "securityFootnote": "Only use this link if you recognize the practice. If you weren’t expecting an invitation, you can ignore this email.",
    "audience": [
      "administrator",
      "member",
      "configured_staff"
    ],
    "cta": "View invitation",
    "code": false,
    "details": [
      {
        "label": "Invitation expires",
        "value": "{{expires_at}}"
      }
    ],
    "existingFlow": false
  },
  {
    "id": "invitation_expired",
    "subject": "Your invitation to {{practice_name}} has expired",
    "preheader": "Ask your practice owner for a new invitation.",
    "heading": "Let’s get a new invite.",
    "body": [
      "Your invitation to join {{practice_name}} has expired.",
      "Ask your practice owner to send a new invitation to the email address you want to use."
    ],
    "securityFootnote": "The expired invitation no longer grants a way to join. Your existing CareIQ account is separate from practice access.",
    "audience": [
      "administrator",
      "member",
      "configured_staff"
    ],
    "cta": null,
    "code": false,
    "details": [],
    "existingFlow": false
  },
  {
    "id": "pending_owner_confirmation",
    "subject": "You’ve joined {{practice_name}}",
    "preheader": "Your practice owner has one more step.",
    "heading": "You’re on the list.",
    "body": [
      "You’ve accepted your invitation to {{practice_name}}.",
      "Your access is waiting for the practice owner to confirm your role and locations. You can check the status in CareIQ."
    ],
    "securityFootnote": "There’s no need to create another account. Joining a practice does not give patient-record access until access is confirmed.",
    "audience": [
      "administrator",
      "member",
      "configured_staff"
    ],
    "cta": "Check access status",
    "code": false,
    "details": [],
    "existingFlow": false
  },
  {
    "id": "owner_join_review",
    "subject": "{{teammate_name}} is ready for your review",
    "preheader": "Confirm their role and location access.",
    "heading": "A teammate has joined.",
    "body": [
      "{{teammate_name}} accepted the invitation to {{practice_name}}.",
      "Review their role and locations in CareIQ before activating their access."
    ],
    "securityFootnote": "Confirm only the access this teammate needs. This email does not activate access.",
    "audience": [
      "owner"
    ],
    "cta": "Review teammate",
    "code": false,
    "details": [
      {
        "label": "Proposed role",
        "value": "{{role_label}}"
      },
      {
        "label": "Proposed locations",
        "value": "{{location_names}}"
      }
    ],
    "existingFlow": false
  },
  {
    "id": "access_ready",
    "subject": "Your access to {{practice_name}} is ready",
    "preheader": "Your practice owner has confirmed your access.",
    "heading": "You’re ready to go.",
    "body": [
      "Your practice owner has confirmed your access to {{practice_name}}.",
      "Open CareIQ to see the work available with your assigned role and locations."
    ],
    "securityFootnote": "Your available features and records depend on your current access. Contact your practice owner if something looks wrong.",
    "audience": [
      "administrator",
      "member",
      "configured_staff"
    ],
    "cta": "Open CareIQ",
    "code": false,
    "details": [
      {
        "label": "Role",
        "value": "{{role_label}}"
      },
      {
        "label": "Locations",
        "value": "{{location_names}}"
      }
    ],
    "existingFlow": false
  },
  {
    "id": "owner_welcome",
    "subject": "A little hello to {{practice_name}}",
    "preheader": "Your practice is ready for its next step.",
    "heading": "Make yourself at home.",
    "body": [
      "{{practice_name}} is set up in CareIQ.",
      "Start with your locations, then invite your team. You’ll confirm each teammate’s role and location access after they join."
    ],
    "securityFootnote": "Practice management and access to patient records are assigned separately. Choose your own location access when you need it.",
    "audience": [
      "owner"
    ],
    "cta": "Open practice setup",
    "code": false,
    "details": [],
    "existingFlow": false
  },
  {
    "id": "patient_secure_request",
    "subject": "A secure request from your care team",
    "preheader": "Your secure paperwork request is ready to open.",
    "heading": "A little less paperwork.",
    "body": [
      "Your care team has a secure paperwork request for you. Open it to get started."
    ],
    "securityFootnote": "This link is personal. Keep it private. If you weren’t expecting a request, contact your care team through a contact method you already know.",
    "audience": [
      "patient"
    ],
    "cta": "Open secure request",
    "code": false,
    "details": [],
    "existingFlow": true
  },
  {
    "id": "patient_paperwork_ready",
    "subject": "Your secure copy is ready",
    "preheader": "Sign in to view or download your completed copy.",
    "heading": "Ready when you are.",
    "body": [
      "Your completed paperwork is available in your secure library. Sign in to view or download your copy."
    ],
    "securityFootnote": "Use your own account to open the secure library. Keep your sign-in details private.",
    "audience": [
      "patient"
    ],
    "cta": "View secure copy",
    "code": false,
    "details": [],
    "existingFlow": true
  },
  {
    "id": "patient_portal_invitation",
    "subject": "Your secure CareIQ access is ready",
    "preheader": "Open CareIQ to continue with your verified account.",
    "heading": "Hello, and welcome.",
    "body": [
      "Your care team has confirmed access for your own account. Open CareIQ to continue."
    ],
    "securityFootnote": "Use the account verified by your care team. If you weren’t expecting this email, contact your care team through a contact method you already know.",
    "audience": [
      "patient"
    ],
    "cta": "Open CareIQ",
    "code": false,
    "details": [],
    "existingFlow": false
  },
  {
    "id": "account_provider_linked",
    "subject": "{{provider_name}} was connected to your CareIQ account",
    "preheader": "A new way to sign in was added.",
    "heading": "Another way in.",
    "body": [
      "{{provider_name}} was connected as a sign-in method for your CareIQ account.",
      "If you made this change, you’re all set. If you didn’t, open CareIQ directly and review your account security."
    ],
    "securityFootnote": "Only connect sign-in accounts you control. CareIQ will never ask for your provider password.",
    "audience": [
      "owner",
      "administrator",
      "member",
      "configured_staff",
      "patient"
    ],
    "cta": "Review account security",
    "code": false,
    "details": [
      {
        "label": "Sign-in provider",
        "value": "{{provider_name}}"
      },
      {
        "label": "Time",
        "value": "{{event_time}}"
      }
    ],
    "existingFlow": false
  },
  {
    "id": "account_provider_unlinked",
    "subject": "{{provider_name}} was disconnected from CareIQ",
    "preheader": "A sign-in method was removed from your account.",
    "heading": "A sign-in method changed.",
    "body": [
      "{{provider_name}} was disconnected from your CareIQ account.",
      "Review your sign-in methods in CareIQ. If you didn’t make this change, review your account security."
    ],
    "securityFootnote": "Use the sign-in methods shown in your CareIQ account. Never share account passwords by email.",
    "audience": [
      "owner",
      "administrator",
      "member",
      "configured_staff",
      "patient"
    ],
    "cta": "Review sign-in methods",
    "code": false,
    "details": [
      {
        "label": "Sign-in provider",
        "value": "{{provider_name}}"
      },
      {
        "label": "Time",
        "value": "{{event_time}}"
      }
    ],
    "existingFlow": false
  },
  {
    "id": "recovery_code_used",
    "subject": "A recovery code was used for CareIQ",
    "preheader": "Please check that this sign-in was yours.",
    "heading": "A recovery code was used.",
    "body": [
      "A saved recovery code was used to complete two-step verification for your CareIQ account.",
      "If this was you, review your remaining sign-in options when you’re ready. If you don’t recognize this, open CareIQ directly and review your account security."
    ],
    "securityFootnote": "Keep saved recovery codes private. CareIQ will never ask you to email them.",
    "audience": [
      "owner",
      "administrator",
      "member",
      "configured_staff",
      "patient"
    ],
    "cta": "Review account security",
    "code": false,
    "details": [
      {
        "label": "Time",
        "value": "{{event_time}}"
      }
    ],
    "existingFlow": false
  },
  {
    "id": "practice_access_changed",
    "subject": "Your access to {{practice_name}} was updated",
    "preheader": "Review your current role and locations.",
    "heading": "Your access has changed.",
    "body": [
      "Your role or location access at {{practice_name}} was updated.",
      "Open CareIQ to review your current access. Contact your practice owner if something looks wrong."
    ],
    "securityFootnote": "Current access in CareIQ determines what you can open. This email does not grant additional access.",
    "audience": [
      "owner",
      "administrator",
      "member",
      "configured_staff"
    ],
    "cta": "Review my access",
    "code": false,
    "details": [
      {
        "label": "Practice",
        "value": "{{practice_name}}"
      },
      {
        "label": "Current role",
        "value": "{{role_label}}"
      },
      {
        "label": "Current locations",
        "value": "{{location_names}}"
      }
    ],
    "existingFlow": false
  },
  {
    "id": "practice_access_removed",
    "subject": "Your access to {{practice_name}} is no longer active",
    "preheader": "Contact your practice owner if you need help.",
    "heading": "An access update.",
    "body": [
      "Your access to {{practice_name}} is no longer active.",
      "If you need help with this change, contact your practice owner. Your CareIQ account is separate from this practice’s access."
    ],
    "securityFootnote": "This message does not change access at any other practice. Do not reply with patient or account details.",
    "audience": [
      "administrator",
      "member",
      "configured_staff"
    ],
    "cta": null,
    "code": false,
    "details": [
      {
        "label": "Practice",
        "value": "{{practice_name}}"
      }
    ],
    "existingFlow": false
  },
  {
    "id": "patient_secure_reminder",
    "subject": "A reminder from your care team",
    "preheader": "Your secure paperwork request is still open.",
    "heading": "A little reminder.",
    "body": [
      "Your secure paperwork request is still open. Complete it when you can."
    ],
    "securityFootnote": "This link is personal. Keep it private. If you need help, contact your care team through a contact method you already know.",
    "audience": [
      "patient"
    ],
    "cta": "Open secure request",
    "code": false,
    "details": [],
    "existingFlow": true
  },
  {
    "id": "staff_work_updates",
    "subject": "Your CareIQ work updates",
    "preheader": "Your work has a little update.",
    "heading": "A little update.",
    "body": [
      "You have {{count}} new work updates. Sign in to CareIQ to review your work."
    ],
    "securityFootnote": "Open CareIQ to review current work. This email does not include patient details.",
    "audience": [
      "owner",
      "administrator",
      "member",
      "configured_staff"
    ],
    "cta": "Open CareIQ",
    "code": false,
    "details": [],
    "existingFlow": true
  }
] as const;

export type LittleHelloPurpose = typeof littleHelloCatalog[number]["id"];
