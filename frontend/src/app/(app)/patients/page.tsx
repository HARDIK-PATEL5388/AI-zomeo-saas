'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Users, Plus, Search, X, Upload, Printer, FileDown, User as UserIcon } from 'lucide-react'
import { mockPatients } from '@/lib/mockData'
import { api } from '@/lib/api'

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------
type Gender = 'male' | 'female' | 'other'

interface Address {
  address?: string; street?: string; country?: string; state?: string; city?: string; zip_code?: string
}
interface PermanentAddress extends Address { same_as_current?: boolean }
interface ContactDetails {
  home_number?: string; office_number?: string; website?: string; emergency_number?: string; fax_number?: string
}

interface Patient {
  id: string
  registration_number?: string
  registration_date?: string
  diagnosis?: string
  title?: string
  first_name: string
  middle_name?: string
  last_name?: string | null
  phone?: string
  email?: string
  date_of_birth?: string
  age?: number
  blood_group?: string
  gender?: Gender | null
  referred_by?: string
  currency?: string
  consultation_charges?: number
  follow_up_charges?: number
  bill_to?: string
  opd_number?: string
  opd_date?: string
  ipd_number?: string
  ipd_date?: string
  remarks?: string
  photo_url?: string
  occupation?: string
  organization?: string
  marital_status?: string
  religion?: string
  diet?: string
  prognosis?: string
  preliminary_remarks?: string
  current_address?: Address
  permanent_address?: PermanentAddress
  contact_details?: ContactDetails
}

const TITLES = ['Mr', 'Mrs', 'Ms', 'Miss', 'Master', 'Dr']
const GENDERS: { v: Gender; l: string }[] = [{ v: 'male', l: 'Male' }, { v: 'female', l: 'Female' }, { v: 'other', l: 'Other' }]
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AUD', 'CAD']
const MARITAL = ['Single', 'Married', 'Divorced', 'Widowed', 'Separated']
const RELIGIONS = ['Hindu', 'Muslim', 'Christian', 'Sikh', 'Jain', 'Buddhist', 'Other']
const DIETS = ['Vegetarian', 'Non-Vegetarian', 'Vegan', 'Eggetarian']
const PROGNOSES = ['Good', 'Fair', 'Guarded', 'Poor']
const COUNTRIES = ['India', 'United States', 'United Kingdom', 'Canada', 'Australia', 'UAE', 'Singapore', 'Other']

const TABS = ['Registration Information', 'Preliminary Information', 'Contact Details', 'Patient Card'] as const
type Tab = typeof TABS[number]

const today = () => new Date().toISOString().slice(0, 10)
const calcAge = (dob?: string) => {
  if (!dob) return undefined
  const d = new Date(dob)
  if (isNaN(d.getTime())) return undefined
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000)))
}

const emptyForm = (): Patient => ({
  id: '',
  registration_date: today(),
  registration_number: '',
  title: 'Mr',
  first_name: '', middle_name: '', last_name: '',
  gender: 'male',
  current_address: {}, permanent_address: { same_as_current: false }, contact_details: {},
  consultation_charges: 0, follow_up_charges: 0,
  currency: 'INR',
})

// ----------------------------------------------------------------------------
// Reusable input
// ----------------------------------------------------------------------------
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        {label}{required && <span className="text-red-500"> *</span>}
      </label>
      {children}
    </div>
  )
}
const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500'

// ----------------------------------------------------------------------------
// Page
// ----------------------------------------------------------------------------
export default function PatientsPage() {
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [tab, setTab] = useState<Tab>('Registration Information')
  const [form, setForm] = useState<Patient>(emptyForm())
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [patients, setPatients] = useState<Patient[]>([])
  const [loading, setLoading] = useState(true)
  const [usingMock, setUsingMock] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Patient Card preview options
  const [cardOpts, setCardOpts] = useState({
    clinic_logo: true, physician_name: true, middle_name: true, age: true,
    registration_number: true, blood_group: true, registration_date: true, photo: false,
  })
  const cardRef = useRef<HTMLDivElement>(null)

  const [loadError, setLoadError] = useState<string | null>(null)

  // ---- Load patients ------------------------------------------------------
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await api.get<{ data: Patient[] }>('/patients')
        if (!alive) return
        setPatients((res.data ?? []).map(normalizePatient))
        setUsingMock(false)
        setLoadError(null)
      } catch (err) {
        if (!alive) return
        const msg = err instanceof Error ? err.message : 'Network error'
        // Only fall back to mock data when not authenticated; show the cause loudly.
        const isAuth = /401|Unauthorized/i.test(msg)
        setPatients(mockPatients as unknown as Patient[])
        setUsingMock(true)
        setLoadError(isAuth
          ? 'Not signed in — patients are NOT being loaded from the database. Please log in.'
          : `Backend unreachable: ${msg}. Showing offline mock data only.`)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- Auto age from DOB --------------------------------------------------
  useEffect(() => {
    if (form.date_of_birth) {
      const a = calcAge(form.date_of_birth)
      if (a !== form.age) setForm(f => ({ ...f, age: a }))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.date_of_birth])

  // ---- Same as current address copy --------------------------------------
  useEffect(() => {
    if (form.permanent_address?.same_as_current) {
      setForm(f => ({
        ...f,
        permanent_address: { ...(f.current_address ?? {}), same_as_current: true },
      }))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.permanent_address?.same_as_current, form.current_address])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return patients
    return patients.filter(p =>
      `${p.first_name ?? ''} ${p.last_name ?? ''} ${p.phone ?? ''} ${p.registration_number ?? ''}`.toLowerCase().includes(q)
    )
  }, [search, patients])

  // ---- Normalize fetched record into form-friendly shape ----------------
  // Backend dates may arrive as ISO timestamps; <input type="date"> needs YYYY-MM-DD.
  // Numerics may arrive as strings; coerce to Number for <input type="number">.
  const toDateOnly = (v?: string | null): string | undefined => {
    if (!v) return undefined
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v
    const d = new Date(v)
    if (isNaN(d.getTime())) return undefined
    // Use UTC to avoid local-tz day-shift (DATE columns have no tz).
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  }
  // Whitelist of patient fields the form is allowed to carry. Anything else
  // returned by the backend (created_at, allergies, last_login_at, …) is
  // dropped so it never gets echoed back to PATCH.
  const FORM_KEYS: (keyof Patient | 'id')[] = [
    'id','registration_date','registration_number','diagnosis','title',
    'first_name','middle_name','last_name','phone','email','date_of_birth','age',
    'blood_group','gender','referred_by','currency','consultation_charges','follow_up_charges',
    'bill_to','opd_number','opd_date','ipd_number','ipd_date','remarks','photo_url',
    'occupation','organization','marital_status','religion','diet','prognosis','preliminary_remarks',
    'current_address','permanent_address','contact_details',
  ]
  const normalizePatient = (p: any): Patient => {
    const out: any = {}
    for (const k of FORM_KEYS) if (p[k] !== undefined) out[k] = p[k]
    out.registration_date = toDateOnly(out.registration_date)
    out.date_of_birth = toDateOnly(out.date_of_birth)
    out.opd_date = toDateOnly(out.opd_date)
    out.ipd_date = toDateOnly(out.ipd_date)
    out.consultation_charges = out.consultation_charges == null ? 0 : Number(out.consultation_charges)
    out.follow_up_charges = out.follow_up_charges == null ? 0 : Number(out.follow_up_charges)
    out.age = out.age == null ? undefined : Number(out.age)
    out.current_address = out.current_address ?? {}
    out.permanent_address = out.permanent_address ?? { same_as_current: false }
    out.contact_details = out.contact_details ?? {}
    return out as Patient
  }

  const openEdit = async (id: string) => {
    setFormError('')
    setEditingId(id)
    setTab('Registration Information')
    setShowModal(true)
    try {
      const res = await api.get<{ data: any }>(`/patients/${id}`)
      setForm(normalizePatient(res.data))
    } catch {
      // fall back to whatever we already have in the list (e.g. offline mock)
      const local = patients.find(p => p.id === id)
      if (local) setForm(normalizePatient(local))
    }
  }

  const openCreate = () => {
    setEditingId(null)
    setForm(emptyForm())
    setTab('Registration Information')
    setShowModal(true)
  }

  // ---- Photo upload (base64 inline) --------------------------------------
  const onPhoto = (file?: File) => {
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { setFormError('Photo must be under 2 MB'); return }
    const reader = new FileReader()
    reader.onload = () => setForm(f => ({ ...f, photo_url: String(reader.result) }))
    reader.readAsDataURL(file)
  }

  // ---- Save ---------------------------------------------------------------
  const validate = (): string | null => {
    if (!form.first_name.trim()) return 'First Name is required (Registration tab).'
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return 'Invalid email address.'
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    const err = validate()
    if (err) { setFormError(err); return }
    setSubmitting(true)
    try {
      // Strip empty strings → undefined so Zod accepts
      const payload: Patient = JSON.parse(JSON.stringify(form, (_k, v) => (v === '' ? undefined : v)))
      delete (payload as any).id

      // eslint-disable-next-line no-console
      console.info('[patients] submit', editingId ? 'PATCH' : 'POST', payload)

      try {
        if (editingId) {
          const res = await api.patch<{ data: Patient }>(`/patients/${editingId}`, payload)
          // eslint-disable-next-line no-console
          console.info('[patients] PATCH ok', res.data)
          setPatients(p => p.map(x => (x.id === editingId ? normalizePatient(res.data) : x)))
        } else {
          const res = await api.post<{ data: Patient }>('/patients', payload)
          // eslint-disable-next-line no-console
          console.info('[patients] POST ok — persisted with id', res.data?.id)
          setPatients(p => [normalizePatient(res.data), ...p])
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Save failed'
        // eslint-disable-next-line no-console
        console.error('[patients] save failed —', msg)
        // DO NOT silently insert into local state — surface the failure so the
        // user knows the row was NOT persisted to the database.
        setFormError(
          /401|Unauthorized/i.test(msg)
            ? 'Not signed in — your patient was NOT saved. Please log in and retry.'
            : `Save failed: ${msg}`
        )
        return
      }

      setShowModal(false)
      setEditingId(null)
      setForm(emptyForm())
      setTab('Registration Information')
    } finally {
      setSubmitting(false)
    }
  }

  // ---- Patient Card actions ---------------------------------------------
  const printCard = () => {
    if (!cardRef.current) return
    const w = window.open('', 'card', 'width=480,height=320')
    if (!w) return
    w.document.write(`<html><head><title>Patient Card</title>
      <style>body{font-family:system-ui,sans-serif;margin:0;padding:24px}
      .card{border:1px solid #e5e7eb;border-radius:12px;padding:20px;max-width:520px}
      .row{margin:6px 0;font-size:14px}.label{color:#6b7280;font-size:12px}
      img{width:96px;height:96px;border-radius:8px;object-fit:cover;border:1px solid #e5e7eb}
      </style></head><body>${cardRef.current.outerHTML}</body></html>`)
    w.document.close()
    w.focus()
    w.print()
  }
  const saveCardPdf = () => {
    // Browser print → "Save as PDF" destination. Native, no extra dep.
    printCard()
  }

  // ----------------------------------------------------------------------------
  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Patients</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {filtered.length} total patients{usingMock && ' · (offline preview)'}
          </p>
        </div>
        <button onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors">
          <Plus className="w-4 h-4" /> Add Patient
        </button>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, phone or reg. number..."
          className="w-full pl-9 pr-4 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
      </div>

      {loadError && (
        <div className="mb-3 px-4 py-3 rounded-lg border border-amber-300 bg-amber-50 text-sm text-amber-800">
          {loadError}{' '}
          <a href="/login" className="underline font-medium">Go to login</a>
        </div>
      )}

      <div className="bg-white rounded-xl border overflow-hidden">
        {loading ? (
          <div className="text-center py-16 text-sm text-gray-500">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <Users className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">No patients yet. Add your first patient.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reg. No.</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Gender</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Age</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => openEdit(p.id)}>
                  <td className="px-4 py-3 text-gray-700">{p.registration_number ?? '—'}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {[p.title, p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' ')}
                  </td>
                  <td className="px-4 py-3 text-gray-600 capitalize">{p.gender ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{p.age ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{p.phone ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{p.email ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* MODAL — multi-tab New Patient                                       */}
      {/* ----------------------------------------------------------------- */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="font-semibold text-gray-900">{editingId ? 'Edit Patient' : 'New Patient'}</h2>
              <button onClick={() => { setShowModal(false); setEditingId(null) }} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Tabs */}
            <div className="border-b px-2 flex gap-1 overflow-x-auto">
              {TABS.map(t => (
                <button key={t} type="button" onClick={() => setTab(t)}
                  className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
                    tab === t ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}>
                  {t}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
              <div className="p-6">

                {/* ---------- TAB 1 : Registration Information ---------- */}
                {tab === 'Registration Information' && (
                  <div className="grid grid-cols-12 gap-4">
                    <div className="col-span-12 md:col-span-9 grid grid-cols-12 gap-4">
                      <div className="col-span-6">
                        <Field label="Registration Date">
                          <input type="date" className={inputCls} value={form.registration_date ?? ''}
                            onChange={e => setForm(f => ({ ...f, registration_date: e.target.value }))} />
                        </Field>
                      </div>
                      <div className="col-span-6">
                        <Field label="Diagnosis">
                          <input className={inputCls} value={form.diagnosis ?? ''}
                            onChange={e => setForm(f => ({ ...f, diagnosis: e.target.value }))} />
                        </Field>
                      </div>

                      <div className="col-span-3">
                        <Field label="Title" required>
                          <select className={inputCls} value={form.title ?? ''}
                            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}>
                            <option value="">--</option>
                            {TITLES.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </Field>
                      </div>
                      <div className="col-span-3">
                        <Field label="First Name" required>
                          <input className={inputCls} value={form.first_name}
                            onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))} />
                        </Field>
                      </div>
                      <div className="col-span-3">
                        <Field label="Middle Name">
                          <input className={inputCls} value={form.middle_name ?? ''}
                            onChange={e => setForm(f => ({ ...f, middle_name: e.target.value }))} />
                        </Field>
                      </div>
                      <div className="col-span-3">
                        <Field label="Last Name">
                          <input className={inputCls} value={form.last_name ?? ''}
                            onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))} />
                        </Field>
                      </div>

                      <div className="col-span-6">
                        <Field label="Mobile Number">
                          <input className={inputCls} value={form.phone ?? ''}
                            onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+91 9876543210" />
                        </Field>
                      </div>
                      <div className="col-span-6">
                        <Field label="Email Id">
                          <input type="email" className={inputCls} value={form.email ?? ''}
                            onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                        </Field>
                      </div>

                      <div className="col-span-3">
                        <Field label="Date Of Birth">
                          <input type="date" className={inputCls} value={form.date_of_birth ?? ''}
                            onChange={e => setForm(f => ({ ...f, date_of_birth: e.target.value }))} />
                        </Field>
                      </div>
                      <div className="col-span-3">
                        <Field label="Age">
                          <input type="number" className={inputCls} value={form.age ?? ''} min={0} max={150}
                            onChange={e => setForm(f => ({ ...f, age: e.target.value === '' ? undefined : Number(e.target.value) }))} />
                        </Field>
                      </div>
                      <div className="col-span-3">
                        <Field label="Blood Group">
                          <select className={inputCls} value={form.blood_group ?? ''}
                            onChange={e => setForm(f => ({ ...f, blood_group: e.target.value }))}>
                            <option value="">--</option>
                            {BLOOD_GROUPS.map(b => <option key={b}>{b}</option>)}
                          </select>
                        </Field>
                      </div>
                      <div className="col-span-3">
                        <Field label="Gender">
                          <select className={inputCls} value={form.gender ?? ''}
                            onChange={e => setForm(f => ({ ...f, gender: (e.target.value || null) as Gender | null }))}>
                            <option value="">--</option>
                            {GENDERS.map(g => <option key={g.v} value={g.v}>{g.l}</option>)}
                          </select>
                        </Field>
                      </div>

                      <div className="col-span-6">
                        <Field label="Referred By">
                          <input className={inputCls} value={form.referred_by ?? ''}
                            onChange={e => setForm(f => ({ ...f, referred_by: e.target.value }))} />
                        </Field>
                      </div>
                      <div className="col-span-6">
                        <Field label="Currency">
                          <select className={inputCls} value={form.currency ?? ''}
                            onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>
                            <option value="">--</option>
                            {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                          </select>
                        </Field>
                      </div>

                      <div className="col-span-4">
                        <Field label="Consultation Charges">
                          <input type="number" min={0} className={inputCls} value={form.consultation_charges ?? 0}
                            onChange={e => setForm(f => ({ ...f, consultation_charges: Number(e.target.value) }))} />
                        </Field>
                      </div>
                      <div className="col-span-4">
                        <Field label="Follow Up Charges">
                          <input type="number" min={0} className={inputCls} value={form.follow_up_charges ?? 0}
                            onChange={e => setForm(f => ({ ...f, follow_up_charges: Number(e.target.value) }))} />
                        </Field>
                      </div>
                      <div className="col-span-4">
                        <Field label="Bill To">
                          <input className={inputCls} value={form.bill_to ?? ''}
                            onChange={e => setForm(f => ({ ...f, bill_to: e.target.value }))} />
                        </Field>
                      </div>

                      <div className="col-span-3">
                        <Field label="OPD Number">
                          <input className={inputCls} value={form.opd_number ?? ''}
                            onChange={e => setForm(f => ({ ...f, opd_number: e.target.value }))} />
                        </Field>
                      </div>
                      <div className="col-span-3">
                        <Field label="OPD Date">
                          <input type="date" className={inputCls} value={form.opd_date ?? ''}
                            onChange={e => setForm(f => ({ ...f, opd_date: e.target.value }))} />
                        </Field>
                      </div>
                      <div className="col-span-3">
                        <Field label="IPD Number">
                          <input className={inputCls} value={form.ipd_number ?? ''}
                            onChange={e => setForm(f => ({ ...f, ipd_number: e.target.value }))} />
                        </Field>
                      </div>
                      <div className="col-span-3">
                        <Field label="IPD Date">
                          <input type="date" className={inputCls} value={form.ipd_date ?? ''}
                            onChange={e => setForm(f => ({ ...f, ipd_date: e.target.value }))} />
                        </Field>
                      </div>

                      <div className="col-span-12">
                        <Field label="Remarks">
                          <textarea rows={3} className={inputCls} value={form.remarks ?? ''}
                            onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))} />
                        </Field>
                      </div>
                    </div>

                    {/* Photo column */}
                    <div className="col-span-12 md:col-span-3">
                      <Field label="Patient Photo">
                        <div className="border border-dashed border-gray-300 rounded-lg p-3 flex flex-col items-center gap-2">
                          {form.photo_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={form.photo_url} alt="patient" className="w-32 h-32 object-cover rounded-md" />
                          ) : (
                            <div className="w-32 h-32 rounded-md bg-gray-100 flex items-center justify-center text-gray-400">
                              <UserIcon className="w-12 h-12" />
                            </div>
                          )}
                          <label className="text-xs cursor-pointer text-emerald-700 hover:underline flex items-center gap-1">
                            <Upload className="w-3.5 h-3.5" /> Upload
                            <input type="file" accept="image/*" className="hidden" onChange={e => onPhoto(e.target.files?.[0])} />
                          </label>
                          {form.photo_url && (
                            <button type="button" className="text-xs text-red-600 hover:underline"
                              onClick={() => setForm(f => ({ ...f, photo_url: undefined }))}>Remove</button>
                          )}
                        </div>
                      </Field>
                    </div>
                  </div>
                )}

                {/* ---------- TAB 2 : Preliminary Information ---------- */}
                {tab === 'Preliminary Information' && (
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Occupation"><input className={inputCls} value={form.occupation ?? ''}
                      onChange={e => setForm(f => ({ ...f, occupation: e.target.value }))} /></Field>
                    <Field label="Organization"><input className={inputCls} value={form.organization ?? ''}
                      onChange={e => setForm(f => ({ ...f, organization: e.target.value }))} /></Field>

                    <Field label="Marital Status">
                      <select className={inputCls} value={form.marital_status ?? ''}
                        onChange={e => setForm(f => ({ ...f, marital_status: e.target.value }))}>
                        <option value="">--</option>
                        {MARITAL.map(m => <option key={m}>{m}</option>)}
                      </select>
                    </Field>
                    <Field label="Religion">
                      <select className={inputCls} value={form.religion ?? ''}
                        onChange={e => setForm(f => ({ ...f, religion: e.target.value }))}>
                        <option value="">--</option>
                        {RELIGIONS.map(m => <option key={m}>{m}</option>)}
                      </select>
                    </Field>

                    <Field label="Diet">
                      <select className={inputCls} value={form.diet ?? ''}
                        onChange={e => setForm(f => ({ ...f, diet: e.target.value }))}>
                        <option value="">--</option>
                        {DIETS.map(m => <option key={m}>{m}</option>)}
                      </select>
                    </Field>
                    <Field label="Prognosis">
                      <select className={inputCls} value={form.prognosis ?? ''}
                        onChange={e => setForm(f => ({ ...f, prognosis: e.target.value }))}>
                        <option value="">--</option>
                        {PROGNOSES.map(m => <option key={m}>{m}</option>)}
                      </select>
                    </Field>

                    <div className="col-span-2">
                      <Field label="Remarks">
                        <textarea rows={4} className={inputCls} value={form.preliminary_remarks ?? ''}
                          onChange={e => setForm(f => ({ ...f, preliminary_remarks: e.target.value }))} />
                      </Field>
                    </div>
                  </div>
                )}

                {/* ---------- TAB 3 : Contact Details ---------- */}
                {tab === 'Contact Details' && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-6">
                      <AddressBlock title="Current Address"
                        value={form.current_address ?? {}}
                        onChange={(v) => setForm(f => ({ ...f, current_address: v }))} />
                      <AddressBlock title="Permanent Address"
                        value={form.permanent_address ?? {}}
                        onChange={(v) => setForm(f => ({ ...f, permanent_address: { ...v, same_as_current: f.permanent_address?.same_as_current } }))}
                        extraTop={
                          <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                            <input type="checkbox"
                              checked={!!form.permanent_address?.same_as_current}
                              onChange={(e) => setForm(f => ({
                                ...f,
                                permanent_address: e.target.checked
                                  ? { ...(f.current_address ?? {}), same_as_current: true }
                                  : { ...(f.permanent_address ?? {}), same_as_current: false },
                              }))} />
                            Same as Current
                          </label>
                        }
                        disabled={!!form.permanent_address?.same_as_current} />
                    </div>

                    <div>
                      <h4 className="text-sm font-semibold text-gray-700 mb-3">Contact Details</h4>
                      <div className="grid grid-cols-3 gap-4">
                        <Field label="Home Number"><input className={inputCls} value={form.contact_details?.home_number ?? ''}
                          onChange={e => setForm(f => ({ ...f, contact_details: { ...(f.contact_details ?? {}), home_number: e.target.value } }))} /></Field>
                        <Field label="Office Number"><input className={inputCls} value={form.contact_details?.office_number ?? ''}
                          onChange={e => setForm(f => ({ ...f, contact_details: { ...(f.contact_details ?? {}), office_number: e.target.value } }))} /></Field>
                        <Field label="Website"><input className={inputCls} value={form.contact_details?.website ?? ''}
                          onChange={e => setForm(f => ({ ...f, contact_details: { ...(f.contact_details ?? {}), website: e.target.value } }))} /></Field>
                        <Field label="Emergency Number"><input className={inputCls} value={form.contact_details?.emergency_number ?? ''}
                          onChange={e => setForm(f => ({ ...f, contact_details: { ...(f.contact_details ?? {}), emergency_number: e.target.value } }))} /></Field>
                        <Field label="Fax Number"><input className={inputCls} value={form.contact_details?.fax_number ?? ''}
                          onChange={e => setForm(f => ({ ...f, contact_details: { ...(f.contact_details ?? {}), fax_number: e.target.value } }))} /></Field>
                      </div>
                    </div>
                  </div>
                )}

                {/* ---------- TAB 4 : Patient Card ---------- */}
                {tab === 'Patient Card' && (
                  <div className="grid grid-cols-12 gap-6">
                    <div className="col-span-4">
                      <p className="text-xs text-gray-500 mb-3">Please select data to be included on the card.</p>
                      <div className="space-y-2 text-sm">
                        {([
                          ['clinic_logo', 'Clinic Logo'], ['physician_name', 'Physician Name'],
                          ['middle_name', 'Middle Name'], ['age', 'Age'],
                          ['registration_number', 'Registration Number'], ['blood_group', 'Blood Group'],
                          ['registration_date', 'Registration Date'], ['photo', 'Photo'],
                        ] as const).map(([k, l]) => (
                          <label key={k} className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={cardOpts[k]}
                              onChange={e => setCardOpts(o => ({ ...o, [k]: e.target.checked }))} />
                            {l}
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="col-span-8">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-gray-500">Live Preview</span>
                        <div className="flex gap-2">
                          <button type="button" onClick={saveCardPdf}
                            className="px-3 py-1.5 bg-cyan-600 text-white rounded-md text-xs flex items-center gap-1 hover:bg-cyan-700">
                            <FileDown className="w-3.5 h-3.5" /> Save as PDF
                          </button>
                          <button type="button" onClick={printCard}
                            className="px-3 py-1.5 bg-cyan-600 text-white rounded-md text-xs flex items-center gap-1 hover:bg-cyan-700">
                            <Printer className="w-3.5 h-3.5" /> Print
                          </button>
                        </div>
                      </div>
                      <div ref={cardRef} className="card border border-gray-200 rounded-xl p-5 bg-white">
                        <div className="flex gap-4">
                          {cardOpts.photo && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={form.photo_url || ''} alt="" className="w-24 h-24 object-cover rounded-md border bg-gray-100" />
                          )}
                          <div className="flex-1 text-sm">
                            {cardOpts.clinic_logo && <div className="text-emerald-700 font-semibold mb-1">Zomeo.ai Clinic</div>}
                            <div className="row"><span className="label text-xs text-gray-500">Name : </span>
                              {[form.title, form.first_name, cardOpts.middle_name && form.middle_name, form.last_name].filter(Boolean).join(' ') || '—'}
                            </div>
                            {cardOpts.registration_number && <div className="row"><span className="label text-xs text-gray-500">Reg No : </span>{form.registration_number || 'auto-generated on save'}</div>}
                            {cardOpts.registration_date && <div className="row"><span className="label text-xs text-gray-500">Reg. Date : </span>{form.registration_date || '—'}</div>}
                            {cardOpts.age && <div className="row"><span className="label text-xs text-gray-500">Age : </span>{form.age ?? '—'}</div>}
                            {cardOpts.blood_group && <div className="row"><span className="label text-xs text-gray-500">Blood Group : </span>{form.blood_group ?? '—'}</div>}
                            {cardOpts.physician_name && <div className="row"><span className="label text-xs text-gray-500">Physician Name : </span>—</div>}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {formError && <p className="mt-4 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{formError}</p>}
              </div>

              {/* Sticky footer */}
              <div className="border-t px-6 py-3 flex items-center justify-between bg-gray-50">
                <span className="text-xs text-red-500">* Fields are mandatory.</span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setShowModal(false)}
                    className="px-4 py-2 border rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
                  <button type="submit" disabled={submitting}
                    className="px-5 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-60">
                    {submitting ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

// ----------------------------------------------------------------------------
// Address sub-block
// ----------------------------------------------------------------------------
function AddressBlock({
  title, value, onChange, extraTop, disabled,
}: {
  title: string
  value: Address
  onChange: (v: Address) => void
  extraTop?: React.ReactNode
  disabled?: boolean
}) {
  const set = (k: keyof Address) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    onChange({ ...value, [k]: e.target.value })
  return (
    <div className={disabled ? 'opacity-60 pointer-events-none' : ''}>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-gray-700">{title}</h4>
        {extraTop}
      </div>
      <div className="space-y-3">
        <Field label="Address"><input className={inputCls} value={value.address ?? ''} onChange={set('address')} /></Field>
        <Field label="Street"><input className={inputCls} value={value.street ?? ''} onChange={set('street')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Select Country">
            <select className={inputCls} value={value.country ?? ''} onChange={set('country')}>
              <option value="">--</option>
              {COUNTRIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Select State"><input className={inputCls} value={value.state ?? ''} onChange={set('state')} /></Field>
          <Field label="Select City"><input className={inputCls} value={value.city ?? ''} onChange={set('city')} /></Field>
          <Field label="Zip Code"><input className={inputCls} value={value.zip_code ?? ''} onChange={set('zip_code')} /></Field>
        </div>
      </div>
    </div>
  )
}
