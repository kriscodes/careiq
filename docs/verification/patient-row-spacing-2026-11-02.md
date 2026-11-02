# Patient row hover spacing — November 2, 2026

The Patients list now keeps 16px of horizontal space inside each row in every state. The avatar, patient details and View Profile action no longer touch the edge of the hover background. Padding is applied before hover, so pointer entry does not move the contents. The hover and keyboard-focus backgrounds share the existing blue treatment and rounded corners.

Only the workflow patient-row styling changed. The legacy patient list already has horizontal padding.

Visual review used synthetic local preview records at 1280px desktop and 320px phone widths. Both layouts showed a 16px avatar inset and no horizontal page overflow. The phone layout keeps View Profile below the patient details.

- [Desktop hover](patient-row-spacing-2026-11-02/desktop.png)
- [Phone hover](patient-row-spacing-2026-11-02/phone.png)
- [Measured layout review](patient-row-spacing-2026-11-02/review.json)

Local acceptance: open Patients, hover a listed patient, then use Tab to focus a row. Check the space around the avatar and the action at desktop and phone widths.
