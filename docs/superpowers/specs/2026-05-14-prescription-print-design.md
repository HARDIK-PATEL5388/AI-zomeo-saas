# Prescription Print — Design

**Date:** 2026-05-14
**Status:** Approved
**Scope:** Add a "Print Prescription" action to the Generate Prescription modal (Analysis page) that renders a professional A4 prescription via `window.print()`. No backend changes.

## Goal

After the doctor fills the prescription form in the Generate Prescription modal and saves the follow-up, they can click "Print Prescription" to open the OS print dialog with a clean A4 prescription showing patient, complaint, diagnosis, remedy details, examination notes, and doctor name. The print is produced from real saved data (no dummy values).

## Non-goals

- Server-side PDF generation
- WhatsApp / email delivery
- Clinic logo upload, custom clinic header content
- Multi-medicine prescriptions (the current modal supports one remedy)

These are future work; the component is designed to be reusable for them.

## User flow

1. Doctor opens Analysis for a case.
2. Picks a remedy, clicks **Generate Prescription** — modal opens.
3. Fills medicine details, clicks **Save Follow-up** — POST `/api/followups` returns `{ id }`.
4. Success block shows in modal with a new **Print Prescription** button alongside the existing "Open follow-up" / "All follow-ups" links.
5. Doctor clicks **Print Prescription**:
   - App fetches `GET /api/followups/:id` (already enriched with patient demographics + `doctor_first_name` / `doctor_last_name`).
   - Renders `<PrescriptionPrint data={...} />` into a print-only DOM container.
   - Calls `window.print()`.
6. OS print dialog opens; doctor prints to paper or saves as PDF.

Printing before save is intentionally **not** supported — print must use the saved canonical record so doctor name and IDs are present.

## Architecture

### New component

`frontend/src/components/prescription/PrescriptionPrint.tsx`

- Pure presentational. Takes a `PrintablePrescription` prop and renders an A4 page.
- Does not fetch data. Caller passes a fully-resolved record.
- Includes a colocated `<style jsx global>` block with `@media print` rules.
- Exports:
  - `PrescriptionPrint({ data }: { data: PrintablePrescription })`
  - `printPrescription(): void` — small helper that calls `window.print()`. Kept separate so the component remains pure.

### Public API

```ts
export type PrintablePrescription = {
  // Identity
  patient_name: string
  patient_age?: number | null
  patient_gender?: string | null
  doctor_name: string
  clinic_name?: string        // defaults to "Zomeo.ai"

  // Visit
  visit_date?: string | null
  next_visit_date?: string | null
  generated_at?: Date         // defaults to now

  // Case context
  chief_complaint?: string | null
  diagnosis?: string | null
  complaints?: string | null

  // Prescription
  remedy_name?: string | null
  remedy_code?: number | null
  potency?: string | null
  dosage?: string | null
  repetition?: string | null
  days?: string | null
  prescription_type?: string | null
  action_taken?: string | null

  // Follow-up details
  remedy_response?: string | null
  investigations?: string | null
  examination?: string | null
  notes?: string | null
}
```

Empty fields render as omitted blocks, not as "—" placeholders, so the printed sheet stays clean.

### Wire-up in analysis page

`frontend/src/app/(app)/analysis/page.tsx`

- Add `printData: PrintablePrescription | null` to component state.
- In the modal's existing `rxSaved` success block, append a **Print Prescription** button (emerald-outlined, with `Printer` icon from lucide-react).
- Button handler:
  1. `await api.get('/followups/' + rxSaved.id)` to get the enriched record.
  2. Map response fields to `PrintablePrescription` (snake_case → typed shape, including derived `doctor_name = "Dr. {first_name} {last_name}".trim()`).
  3. `setPrintData(mapped)`.
  4. In a `useEffect` watching `printData`, once mounted, call `window.print()`.
  5. After print dialog closes (`window.onafterprint`), reset `printData` to `null` so the hidden DOM is freed.
- Mount `{printData && <PrescriptionPrint data={printData} />}` at page root so it sits outside the modal.

## Data flow

```
modal "Save Follow-up"
  └── POST /api/followups        → rxSaved.id
modal "Print Prescription"
  └── GET  /api/followups/:id    → full row enriched with:
       • patient_first_name, last_name, age, gender
       • doctor_first_name, doctor_last_name
       • case_chief_complaint
       • all Rx fields
  └── map → setPrintData(mapped)
  └── useEffect → window.print()
  └── window.onafterprint → setPrintData(null)
```

No backend change. `backend/src/routes/followups.ts:153-188` (GET /:id) already provides every field needed except `clinic_name`. Clinic name defaults to "Zomeo.ai" in the component until a clinic-name API surfaces.

## Print CSS

Strategy: keep the entire app DOM mounted, hide everything except the print container via `visibility: hidden`. This avoids React unmount/remount churn around the native print dialog.

```css
@media print {
  @page { size: A4; margin: 14mm; }
  body { background: #fff !important; }
  body * { visibility: hidden !important; }
  #rx-print-root, #rx-print-root * { visibility: visible !important; }
  #rx-print-root { position: absolute; inset: 0; box-shadow: none; }
  .no-print { display: none !important; }
}
@media screen {
  #rx-print-root { display: none; }   /* hidden until print is invoked */
}
```

- The component renders inside `<div id="rx-print-root">`.
- Modal buttons, sidebar, dashboard chrome — all hidden via the universal `visibility: hidden` rule.
- `.no-print` is available for explicit opt-out elements if needed.

## Layout (A4)

Header bar (emerald) — clinic_name + "Prescription" + generated-date.
Two-column patient/visit row.
Chief Complaint section.
Diagnosis + Complaints two-column.
Rx block (with ℞ glyph) — remedy, potency, dosage, repetition, days, type, action taken.
Examination / Investigations / Remedy Response three-column.
Notes full-width.
Footer — generated timestamp left, doctor name + signature line right.

Typography: system serif (`'Georgia', serif`) for prescription body — feels clinical; sans-serif for header.
Spacing: ~14mm page margin, generous line-height in the Rx block.

## Files touched

| File | Change | Approx LOC |
|---|---|---|
| `frontend/src/components/prescription/PrescriptionPrint.tsx` | New file | ~180 |
| `frontend/src/app/(app)/analysis/page.tsx` | Add fetch + Print button + mount print container | ~40 |

No backend file, no schema migration, no new dependency.

## Verification

Manual browser test (the implementation must include this, not just type-check pass):

1. `npm run dev` in `frontend/` and `backend/`.
2. Log in, open a case, run analysis, pick a remedy.
3. Click **Generate Prescription**, fill all fields, click **Save Follow-up**.
4. Click new **Print Prescription** button in the success block.
5. Browser print preview opens.
   - Only the prescription is visible — sidebar, modal, page chrome are hidden.
   - A4 paper size, sensible margins.
   - All filled fields present; empty fields omitted (no "—").
   - Patient name, age/gender, doctor name (Dr. {first} {last}), Zomeo.ai header, visit date, generated timestamp all present.
6. Close print dialog; main app is fully interactive again.
7. Verify second print works (state reset after `onafterprint`).

## Risks / open items

- **Clinic name.** Falls back to "Zomeo.ai" until a clinic-name field is exposed by the API. The component already accepts `clinic_name` so swapping later is a one-line change at the call site.
- **Doctor name missing.** If the saved follow-up record has no `doctor_first_name` (e.g., a doctor with empty profile name), we render the doctor block as "Dr. —". Acceptable for v1.
- **Print isolation in nested fixed-position elements.** The modal uses `fixed inset-0 z-50`. Because `visibility: hidden` cascades but doesn't remove from layout, the modal backdrop stays hidden behind the print container during print — verified by the `position: absolute; inset: 0` on `#rx-print-root` overriding stacking. If glitches appear, fallback is `display: none` on `body > *` except print root.

## Future work (not in this change)

- Server-rendered PDF (Puppeteer) for email/WhatsApp.
- Clinic logo + clinic_name on header.
- Multi-medicine prescription support when the data model gains it.
- Shareable signed-URL print pages.
