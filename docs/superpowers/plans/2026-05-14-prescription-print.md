# Prescription Print Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Print Prescription" button to the Generate Prescription modal that renders an A4 printable prescription from the saved follow-up record via `window.print()`. No backend changes.

**Architecture:** A pure presentational component `PrescriptionPrint` consumes a typed `PrintablePrescription` prop and renders an A4 sheet inside `<div id="rx-print-root">`. A colocated `@media print` stylesheet hides everything else via `visibility:hidden`. The analysis page wires a Print button into the modal's existing success block — on click it fetches `GET /api/followups/:id` (already enriched with patient + doctor names), maps the response to the component prop, mounts the component, then calls `window.print()`.

**Tech Stack:** Next.js 14 (App Router) · React 18 · TypeScript · TailwindCSS · lucide-react icons · `window.print()` (no new dependency).

**Verification approach:** This is a print-CSS-driven UI feature. The project has no existing UI unit-test setup (no `npm test` script, no `*.test.tsx` files outside `node_modules`). Browser print preview cannot be meaningfully unit-tested with JSDOM. The verification gate for this plan is therefore:
1. `npm run type-check` from `frontend/` passes.
2. `npm run lint` from `frontend/` shows no new warnings.
3. Manual browser verification (Task 6) — every checkbox in that task must be confirmed by visually inspecting the print preview.

**Reference spec:** `docs/superpowers/specs/2026-05-14-prescription-print-design.md`

---

## File Structure

| Path | Responsibility | New / Modify |
|---|---|---|
| `frontend/src/components/prescription/PrescriptionPrint.tsx` | Pure A4 prescription renderer + print CSS + `printPrescription()` helper | **New** |
| `frontend/src/app/(app)/analysis/page.tsx` | Import component, add Print button to modal success block, fetch + map data, call `window.print()`, cleanup on `afterprint` | **Modify** (lines 92-118 state, lines 847-857 success block, plus a new effect + JSX mount at page root) |

No other files touched. No new npm dependency. No backend changes. No schema migration.

---

## Task 1: Scaffold `PrescriptionPrint` component with types + helper

**Files:**
- Create: `frontend/src/components/prescription/PrescriptionPrint.tsx`

- [ ] **Step 1: Create the file with type, helper, and a minimal render**

Write `frontend/src/components/prescription/PrescriptionPrint.tsx`:

```tsx
'use client'

import { useMemo } from 'react'

export type PrintablePrescription = {
  patient_name: string
  patient_age?: number | null
  patient_gender?: string | null
  doctor_name: string
  clinic_name?: string

  visit_date?: string | null
  next_visit_date?: string | null
  generated_at?: Date

  chief_complaint?: string | null
  diagnosis?: string | null
  complaints?: string | null

  remedy_name?: string | null
  remedy_code?: number | null
  potency?: string | null
  dosage?: string | null
  repetition?: string | null
  days?: string | null
  prescription_type?: string | null
  action_taken?: string | null

  remedy_response?: string | null
  investigations?: string | null
  examination?: string | null
  notes?: string | null
}

export function printPrescription(): void {
  if (typeof window !== 'undefined') window.print()
}

function formatDate(s?: string | null): string {
  if (!s) return ''
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatDateTime(d?: Date): string {
  const x = d ?? new Date()
  return x.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

export function PrescriptionPrint({ data }: { data: PrintablePrescription }) {
  const clinic = data.clinic_name?.trim() || 'Zomeo.ai'
  const generatedAt = useMemo(() => formatDateTime(data.generated_at), [data.generated_at])

  return (
    <div id="rx-print-root" className="rx-print">
      <div className="rx-page">
        <header className="rx-header">
          <div>
            <h1 className="rx-brand">{clinic}</h1>
            <p className="rx-tagline">Homeopathic Care</p>
          </div>
          <div className="rx-header-right">
            <h2 className="rx-title">Prescription</h2>
            <p className="rx-meta">Generated: {generatedAt}</p>
          </div>
        </header>

        {/* Sections injected in Tasks 2-4 */}
      </div>

      <style jsx global>{`
        @media print {
          @page { size: A4; margin: 14mm; }
          html, body { background: #fff !important; }
          body * { visibility: hidden !important; }
          #rx-print-root, #rx-print-root * { visibility: visible !important; }
          #rx-print-root {
            position: absolute;
            inset: 0;
            box-shadow: none;
          }
          .no-print { display: none !important; }
        }
        @media screen {
          #rx-print-root { display: none; }
        }
        .rx-print {
          font-family: 'Georgia', 'Times New Roman', serif;
          color: #0f172a;
        }
        .rx-page {
          width: 100%;
          padding: 0;
        }
        .rx-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          padding-bottom: 10px;
          border-bottom: 2px solid #059669;
          margin-bottom: 14px;
        }
        .rx-brand {
          margin: 0;
          font-family: 'Helvetica', 'Arial', sans-serif;
          font-size: 24px;
          font-weight: 700;
          color: #059669;
          letter-spacing: -0.01em;
        }
        .rx-tagline {
          margin: 2px 0 0 0;
          font-size: 11px;
          color: #64748b;
          font-family: 'Helvetica', sans-serif;
        }
        .rx-header-right {
          text-align: right;
        }
        .rx-title {
          margin: 0;
          font-size: 18px;
          font-weight: 600;
          color: #0f172a;
        }
        .rx-meta {
          margin: 2px 0 0 0;
          font-size: 10.5px;
          color: #64748b;
        }
      `}</style>
    </div>
  )
}
```

- [ ] **Step 2: Verify the file compiles**

Run from repo root:
```
cd frontend && npm run type-check
```
Expected: no errors. (If the user's environment uses PowerShell, run the two commands separately: `cd frontend` then `npm run type-check`.)

- [ ] **Step 3: Commit**

```
git add frontend/src/components/prescription/PrescriptionPrint.tsx
git commit -m "feat(prescription): scaffold PrescriptionPrint component with print CSS"
```

---

## Task 2: Add patient + visit identity sections

**Files:**
- Modify: `frontend/src/components/prescription/PrescriptionPrint.tsx` (add JSX after `</header>` and additional CSS rules)

- [ ] **Step 1: Replace the `{/* Sections injected in Tasks 2-4 */}` comment with the identity sections**

In `frontend/src/components/prescription/PrescriptionPrint.tsx`, replace this line:

```tsx
        {/* Sections injected in Tasks 2-4 */}
```

with this JSX:

```tsx
        <section className="rx-identity">
          <div className="rx-col">
            <h3 className="rx-section-label">Patient</h3>
            <p className="rx-field-value rx-field-value-strong">{data.patient_name || '—'}</p>
            {(data.patient_age != null || data.patient_gender) && (
              <p className="rx-field-value rx-field-value-muted">
                {data.patient_age != null ? `${data.patient_age} yrs` : ''}
                {data.patient_age != null && data.patient_gender ? ' · ' : ''}
                {data.patient_gender ?? ''}
              </p>
            )}
          </div>
          <div className="rx-col">
            <h3 className="rx-section-label">Visit</h3>
            {data.visit_date && (
              <p className="rx-field-value">
                <span className="rx-inline-label">Date:</span> {formatDate(data.visit_date)}
              </p>
            )}
            {data.next_visit_date && (
              <p className="rx-field-value">
                <span className="rx-inline-label">Next Visit:</span> {formatDate(data.next_visit_date)}
              </p>
            )}
          </div>
        </section>

        {data.chief_complaint && (
          <section className="rx-block">
            <h3 className="rx-section-label">Chief Complaint</h3>
            <p className="rx-field-value">{data.chief_complaint}</p>
          </section>
        )}
```

- [ ] **Step 2: Add the supporting CSS classes**

In the same file, inside the `<style jsx global>` template literal, append these rules immediately after the `.rx-meta { … }` block:

```css
        .rx-identity {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 18px;
          margin-bottom: 14px;
        }
        .rx-col {
          min-width: 0;
        }
        .rx-section-label {
          margin: 0 0 4px 0;
          font-family: 'Helvetica', sans-serif;
          font-size: 9.5px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #64748b;
        }
        .rx-field-value {
          margin: 0 0 2px 0;
          font-size: 12px;
          line-height: 1.45;
        }
        .rx-field-value-strong {
          font-weight: 700;
          font-size: 13.5px;
        }
        .rx-field-value-muted {
          color: #475569;
          font-size: 11px;
        }
        .rx-inline-label {
          color: #64748b;
          font-size: 11px;
          font-family: 'Helvetica', sans-serif;
          margin-right: 4px;
        }
        .rx-block {
          padding: 10px 0;
          border-top: 1px solid #e2e8f0;
          margin-bottom: 4px;
        }
```

- [ ] **Step 3: Verify the file compiles**

Run from repo root:
```
cd frontend && npm run type-check
```
Expected: no errors.

- [ ] **Step 4: Commit**

```
git add frontend/src/components/prescription/PrescriptionPrint.tsx
git commit -m "feat(prescription): add patient/visit identity sections"
```

---

## Task 3: Add the Rx prescription block (remedy, potency, dosage, repetition, days, type, action)

**Files:**
- Modify: `frontend/src/components/prescription/PrescriptionPrint.tsx`

- [ ] **Step 1: Add the Rx section JSX**

Immediately after the `{data.chief_complaint && ( … )}` block from Task 2, append:

```tsx
        <section className="rx-script">
          <div className="rx-script-header">
            <span className="rx-glyph">℞</span>
            <h3 className="rx-script-title">Prescription</h3>
          </div>
          <table className="rx-script-table">
            <tbody>
              {data.remedy_name && (
                <tr>
                  <th>Remedy</th>
                  <td>
                    <strong>{data.remedy_name}</strong>
                    {data.remedy_code != null && (
                      <span className="rx-code"> #{data.remedy_code}</span>
                    )}
                  </td>
                </tr>
              )}
              {(data.potency || data.dosage) && (
                <tr>
                  <th>Potency</th>
                  <td>{data.potency || '—'}</td>
                  <th>Dosage</th>
                  <td>{data.dosage || '—'}</td>
                </tr>
              )}
              {(data.repetition || data.days) && (
                <tr>
                  <th>Repetition</th>
                  <td>{data.repetition || '—'}</td>
                  <th>Days</th>
                  <td>{data.days || '—'}</td>
                </tr>
              )}
              {(data.prescription_type || data.action_taken) && (
                <tr>
                  <th>Type</th>
                  <td>{data.prescription_type ? titleCase(data.prescription_type) : '—'}</td>
                  <th>Action</th>
                  <td>{data.action_taken ? titleCase(data.action_taken.replace(/_/g, ' ')) : '—'}</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
```

- [ ] **Step 2: Add the `titleCase` helper**

In the same file, just above the `export function PrescriptionPrint(…)` line, add:

```ts
function titleCase(s: string): string {
  return s.replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase())
}
```

- [ ] **Step 3: Add the supporting CSS**

Inside the `<style jsx global>` block, append after `.rx-block { … }`:

```css
        .rx-script {
          margin-top: 10px;
          padding: 12px 14px;
          background: #f0fdf4;
          border: 1px solid #bbf7d0;
          border-radius: 6px;
        }
        .rx-script-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
          padding-bottom: 6px;
          border-bottom: 1px dashed #86efac;
        }
        .rx-glyph {
          font-family: 'Georgia', serif;
          font-size: 22px;
          font-weight: 700;
          color: #059669;
          line-height: 1;
        }
        .rx-script-title {
          margin: 0;
          font-family: 'Helvetica', sans-serif;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #047857;
        }
        .rx-script-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
        }
        .rx-script-table th {
          text-align: left;
          font-family: 'Helvetica', sans-serif;
          font-size: 9.5px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #64748b;
          padding: 4px 10px 4px 0;
          width: 80px;
          vertical-align: top;
        }
        .rx-script-table td {
          padding: 4px 16px 4px 0;
          vertical-align: top;
          font-size: 12px;
          line-height: 1.4;
        }
        .rx-code {
          font-family: 'Courier New', monospace;
          font-size: 11px;
          color: #64748b;
          margin-left: 4px;
        }
```

- [ ] **Step 4: Verify the file compiles**

```
cd frontend && npm run type-check
```
Expected: no errors.

- [ ] **Step 5: Commit**

```
git add frontend/src/components/prescription/PrescriptionPrint.tsx
git commit -m "feat(prescription): add Rx block with remedy, potency, dosage, repetition"
```

---

## Task 4: Add follow-up details + footer with doctor signature

**Files:**
- Modify: `frontend/src/components/prescription/PrescriptionPrint.tsx`

- [ ] **Step 1: Add the diagnosis/details/notes/footer JSX**

Immediately after the closing `</section>` of the `.rx-script` block from Task 3, append:

```tsx
        {(data.diagnosis || data.complaints) && (
          <section className="rx-grid-2">
            {data.diagnosis && (
              <div>
                <h3 className="rx-section-label">Diagnosis</h3>
                <p className="rx-field-value">{data.diagnosis}</p>
              </div>
            )}
            {data.complaints && (
              <div>
                <h3 className="rx-section-label">Complaints</h3>
                <p className="rx-field-value">{data.complaints}</p>
              </div>
            )}
          </section>
        )}

        {(data.examination || data.investigations || data.remedy_response) && (
          <section className="rx-grid-3">
            {data.examination && (
              <div>
                <h3 className="rx-section-label">Examination</h3>
                <p className="rx-field-value">{data.examination}</p>
              </div>
            )}
            {data.investigations && (
              <div>
                <h3 className="rx-section-label">Investigations</h3>
                <p className="rx-field-value">{data.investigations}</p>
              </div>
            )}
            {data.remedy_response && (
              <div>
                <h3 className="rx-section-label">Remedy Response</h3>
                <p className="rx-field-value">{data.remedy_response}</p>
              </div>
            )}
          </section>
        )}

        {data.notes && (
          <section className="rx-block">
            <h3 className="rx-section-label">Notes</h3>
            <p className="rx-field-value">{data.notes}</p>
          </section>
        )}

        <footer className="rx-footer">
          <div className="rx-footer-left">
            <p className="rx-meta">Generated: {generatedAt}</p>
          </div>
          <div className="rx-footer-right">
            <div className="rx-sig-line" />
            <p className="rx-doctor-name">{data.doctor_name?.trim() || 'Doctor'}</p>
            <p className="rx-meta">Signature</p>
          </div>
        </footer>
```

- [ ] **Step 2: Add the supporting CSS**

Inside the `<style jsx global>` block, append after the `.rx-code { … }` rule:

```css
        .rx-grid-2 {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 18px;
          margin-top: 12px;
        }
        .rx-grid-3 {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 14px;
          margin-top: 12px;
        }
        .rx-footer {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          margin-top: 28px;
          padding-top: 12px;
          border-top: 1px solid #e2e8f0;
        }
        .rx-footer-left {
          flex: 1;
        }
        .rx-footer-right {
          text-align: right;
          min-width: 200px;
        }
        .rx-sig-line {
          width: 200px;
          border-bottom: 1px solid #0f172a;
          margin: 0 0 4px auto;
          height: 24px;
        }
        .rx-doctor-name {
          margin: 0;
          font-size: 12px;
          font-weight: 700;
          color: #0f172a;
        }
```

- [ ] **Step 3: Verify the file compiles**

```
cd frontend && npm run type-check
```
Expected: no errors.

- [ ] **Step 4: Commit**

```
git add frontend/src/components/prescription/PrescriptionPrint.tsx
git commit -m "feat(prescription): add diagnosis, examination, notes, doctor footer"
```

---

## Task 5: Wire Print button + data fetch into the Generate Prescription modal

**Files:**
- Modify: `frontend/src/app/(app)/analysis/page.tsx`

This task makes five surgical edits to one file. Apply them in order.

- [ ] **Step 1: Add the `Printer` icon to the lucide import**

In `frontend/src/app/(app)/analysis/page.tsx`, find this import block (lines ~5-8):

```ts
import {
  Search, Plus, Trash2, Sparkles, Play, X, Save, FileText,
  RotateCcw, FilePlus2, ChevronRight, Pill, BookOpen,
} from 'lucide-react'
```

Replace it with:

```ts
import {
  Search, Plus, Trash2, Sparkles, Play, X, Save, FileText,
  RotateCcw, FilePlus2, ChevronRight, Pill, BookOpen, Printer,
} from 'lucide-react'
```

- [ ] **Step 2: Add the component + helper imports**

Immediately after the `import { api } from '@/lib/api'` line (~line 9), add:

```ts
import { PrescriptionPrint, printPrescription, type PrintablePrescription } from '@/components/prescription/PrescriptionPrint'
```

- [ ] **Step 3: Add print-related state and the fetch+print handler**

Find the existing state block (line ~117):

```ts
  const [rxSaving, setRxSaving] = useState(false)
  const [rxSaved, setRxSaved] = useState<{ id: string } | null>(null)
  const [rxError, setRxError] = useState<string | null>(null)
```

Add three new lines after `setRxError` so the block becomes:

```ts
  const [rxSaving, setRxSaving] = useState(false)
  const [rxSaved, setRxSaved] = useState<{ id: string } | null>(null)
  const [rxError, setRxError] = useState<string | null>(null)
  const [printData, setPrintData] = useState<PrintablePrescription | null>(null)
  const [printLoading, setPrintLoading] = useState(false)
  const [printError, setPrintError] = useState<string | null>(null)
```

- [ ] **Step 4: Add the print handler and the `afterprint` cleanup effect**

Immediately before the existing `const handleExportPdf = () => { … }` (around line 270), add:

```ts
  // Re-fetches the saved follow-up (enriched with patient + doctor names)
  // and triggers the browser print dialog.
  const handlePrintPrescription = async () => {
    if (!rxSaved?.id) return
    setPrintError(null)
    setPrintLoading(true)
    try {
      const res = await api.get<{ data: any }>(`/followups/${rxSaved.id}`)
      const r = res.data
      const doctorName = [r.doctor_first_name, r.doctor_last_name]
        .filter(Boolean)
        .join(' ')
        .trim()
      const mapped: PrintablePrescription = {
        patient_name: r.patient_name || `${r.patient_first_name ?? ''} ${r.patient_last_name ?? ''}`.trim(),
        patient_age: r.patient_age ?? null,
        patient_gender: r.patient_gender ?? null,
        doctor_name: doctorName ? `Dr. ${doctorName}` : 'Doctor',
        visit_date: r.visit_date ?? r.followup_date ?? null,
        next_visit_date: r.next_visit_date ?? r.next_followup_date ?? null,
        chief_complaint: r.case_chief_complaint ?? null,
        diagnosis: r.diagnosis ?? null,
        complaints: r.complaints ?? null,
        remedy_name: r.remedy_name ?? null,
        remedy_code: r.remedy_code ?? null,
        potency: r.potency ?? null,
        dosage: r.dosage ?? null,
        repetition: r.repetition ?? null,
        days: r.days ?? null,
        prescription_type: r.prescription_type ?? null,
        action_taken: r.action_taken ?? null,
        remedy_response: r.remedy_response ?? null,
        investigations: r.investigations ?? null,
        examination: r.examination ?? null,
        notes: r.notes ?? r.doctor_notes ?? null,
        generated_at: new Date(),
      }
      setPrintData(mapped)
    } catch (err) {
      setPrintError(err instanceof Error ? err.message : 'Failed to load prescription')
    } finally {
      setPrintLoading(false)
    }
  }

  // When printData becomes available, open the OS print dialog on the next paint.
  useEffect(() => {
    if (!printData) return
    const id = requestAnimationFrame(() => printPrescription())
    return () => cancelAnimationFrame(id)
  }, [printData])

  // Free the print container after the user closes the print dialog.
  useEffect(() => {
    const onAfter = () => setPrintData(null)
    window.addEventListener('afterprint', onAfter)
    return () => window.removeEventListener('afterprint', onAfter)
  }, [])
```

- [ ] **Step 5: Extend the modal's `rxSaved` success block with the Print button**

Find the success block (around lines 847-857):

```tsx
              {rxSaved && (
                <div className="col-span-2 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex items-center justify-between gap-3">
                  <span>✓ Follow-up saved successfully.</span>
                  <span className="flex items-center gap-2">
                    <a href={`/followups/${rxSaved.id}`} className="underline font-medium">
                      Open follow-up →
                    </a>
                    <a href="/followups" className="underline">All follow-ups</a>
                  </span>
                </div>
              )}
```

Replace it with:

```tsx
              {rxSaved && (
                <div className="col-span-2 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex items-center justify-between gap-3 flex-wrap">
                  <span>✓ Follow-up saved successfully.</span>
                  <span className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handlePrintPrescription}
                      disabled={printLoading}
                      className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 text-xs font-medium disabled:opacity-50"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      {printLoading ? 'Preparing…' : 'Print Prescription'}
                    </button>
                    <a href={`/followups/${rxSaved.id}`} className="underline font-medium">
                      Open follow-up →
                    </a>
                    <a href="/followups" className="underline">All follow-ups</a>
                  </span>
                  {printError && (
                    <span className="basis-full text-xs text-red-600">{printError}</span>
                  )}
                </div>
              )}
```

- [ ] **Step 6: Mount the print component at page root**

Find the existing page's outermost return — the line just before the final `</div>` and `)` that closes the `AnalysisPage` JSX (around lines 913-915):

```tsx
        </div>
      )}
    </div>
  )
}
```

Replace it with:

```tsx
        </div>
      )}

      {printData && <PrescriptionPrint data={printData} />}
    </div>
  )
}
```

- [ ] **Step 7: Verify the file compiles**

```
cd frontend && npm run type-check
```
Expected: no errors.

- [ ] **Step 8: Verify lint passes**

```
cd frontend && npm run lint
```
Expected: no new warnings or errors introduced by this change. If the project has pre-existing lint warnings in unrelated files, they're acceptable; warnings inside `analysis/page.tsx` or `PrescriptionPrint.tsx` are not.

- [ ] **Step 9: Commit**

```
git add frontend/src/app/(app)/analysis/page.tsx
git commit -m "feat(prescription): wire Print Prescription button into modal"
```

---

## Task 6: Manual browser verification

**Files:** none — this task is verification only. Do not commit "verified" markers.

This is the gate for "complete". Every box must be physically checked by opening the browser and confirming.

- [ ] **Step 1: Start both servers**

In one shell:
```
cd backend && npm run dev
```
In another:
```
cd frontend && npm run dev
```
Wait until both report ready. Open http://localhost:3000.

- [ ] **Step 2: Reach the Generate Prescription modal with real data**

1. Log in.
2. Navigate to a case that has at least one rubric selected. If none exists, create a patient → case → add one rubric.
3. Open `/analysis?caseId=<id>`.
4. Click **Run Repertorization** — wait for results.
5. Click a remedy row to select it (so `selectedRemCode` is set).
6. Click **Generate Prescription** — the modal opens.
7. Fill in: Visit Date (today), Next Visit Date, Potency, Dosage, Repetition, Days, Prescription Type, Action Taken, Complaints, Diagnosis, Examination, Investigations, Notes. Leave one or two fields blank intentionally to verify empty-section hiding.
8. Click **Save Follow-up** — wait for the success block to appear.

- [ ] **Step 3: Verify the Print Prescription button appears**

The success block now shows three actions:
- A green **Print Prescription** button with a printer icon
- "Open follow-up →" link
- "All follow-ups" link

If the button is missing, Task 5 Step 5 was not applied correctly.

- [ ] **Step 4: Click Print Prescription and inspect the preview**

1. Click **Print Prescription**.
2. Button text briefly changes to "Preparing…".
3. The OS print dialog opens (or browser print preview, depending on browser).

In the preview, verify all of:
- [ ] Page size is A4 (visible in the right-hand print panel for Chrome/Edge).
- [ ] **Only** the prescription is visible. Sidebar, top bar, modal, footer buttons are all hidden.
- [ ] Header bar shows "Zomeo.ai" + "Homeopathic Care" left, "Prescription" + "Generated: …" right, with an emerald underline.
- [ ] Patient Name + age/gender appear under "Patient".
- [ ] Visit Date + Next Visit appear under "Visit" (Next Visit only if you filled it).
- [ ] Chief Complaint section shows the case's chief complaint text.
- [ ] The Rx block has an ℞ glyph and shows: Remedy (with `#code`), Potency, Dosage, Repetition, Days, Type, Action.
- [ ] Diagnosis + Complaints render in a two-column grid.
- [ ] Examination / Investigations / Remedy Response render in a three-column grid (columns you left blank are omitted, not shown as "—").
- [ ] Notes section renders.
- [ ] Footer shows "Generated: dd mmm yyyy, hh:mm" left and "Dr. {first} {last}" with a signature line right.
- [ ] Page margins look like ~14mm — text doesn't crowd the page edge.

- [ ] **Step 5: Verify cleanup after print dialog closes**

1. In the print preview, click **Cancel** (or close the print dialog).
2. Back on the main app, confirm:
   - The Generate Prescription modal is still open.
   - The success block still shows.
   - No leftover prescription DOM is visible on the page.
3. Click **Print Prescription** again — confirm it opens fresh (printData was reset).

- [ ] **Step 6: Verify "Save as PDF" path**

1. Click **Print Prescription** again.
2. In the print dialog, change destination to **Save as PDF** and save.
3. Open the saved PDF and confirm it matches what was on screen — A4, one page, all sections.

- [ ] **Step 7: Verify the page chrome works after a print round-trip**

1. Close the modal (Close button in modal footer).
2. Click around the analysis page — search rubrics, switch tabs.
3. Confirm the page is fully interactive. The browser hasn't left any `visibility:hidden` residue from print CSS (this would only happen if @media print is malformed).

If anything in Steps 4-7 fails, **do not commit**; reopen the relevant task and fix.

- [ ] **Step 8: Final verification commit (no code change)**

Only run this once every checkbox above is checked. There's nothing to commit at this step — the feature is complete. Simply move on.

---

## Done criteria

- All 6 tasks above are completed and committed.
- `npm run type-check` and `npm run lint` in `frontend/` produce no new errors or warnings in the two touched files.
- Every checkbox in Task 6 is physically verified in a real browser.
- The spec at `docs/superpowers/specs/2026-05-14-prescription-print-design.md` matches what was built.

## Notes for the implementing engineer

- **Don't introduce a new dep.** Everything uses the existing stack (`window.print()`, Tailwind, lucide). No `react-to-print`, no `jspdf`.
- **Don't unmount the app to print.** The `visibility:hidden` strategy is intentional — it keeps React state and `useEffect`s stable across the print round-trip.
- **Don't trust `window.print()` to be async-clean.** `afterprint` fires when the dialog closes, but `beforeprint` does NOT fire on every browser; we use it only via the post-paint trigger from the `printData` effect, not to mount.
- **Don't add doctor name to localStorage.** The data comes from the backend (enriched GET /:id). Putting it in localStorage would risk staleness when the doctor profile changes.
- **Empty-string vs null.** Backend may return `''` or `null` for blank fields. The component treats both as absent via JSX falsy checks; do not normalize at the boundary.
