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
