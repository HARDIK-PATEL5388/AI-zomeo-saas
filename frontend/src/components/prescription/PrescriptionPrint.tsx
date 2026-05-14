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

function titleCase(s: string): string {
  return s.replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase())
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
      `}</style>
    </div>
  )
}
