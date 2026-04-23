// Mock data for dashboard and all pages (used when DB is not connected)

export const mockStats = {
  patients: 24,
  active_cases: 11,
  prescriptions: 18,
  followups_due: 5,
}

export const mockPatients: Array<{ id: string; first_name: string; last_name: string; gender: 'male' | 'female' | 'other'; age: number; phone: string; email: string; address: string; is_active: boolean; created_at: string }> = [
  { id: '1', first_name: 'Rajesh', last_name: 'Sharma', gender: 'male', age: 42, phone: '9876543210', email: 'rajesh@email.com', address: 'Mumbai, Maharashtra', is_active: true, created_at: '2025-01-10T08:00:00Z' },
  { id: '2', first_name: 'Priya', last_name: 'Patel', gender: 'female', age: 35, phone: '9812345678', email: 'priya@email.com', address: 'Ahmedabad, Gujarat', is_active: true, created_at: '2025-01-15T09:00:00Z' },
  { id: '3', first_name: 'Suresh', last_name: 'Kumar', gender: 'male', age: 58, phone: '9723456789', email: 'suresh@email.com', address: 'Delhi', is_active: true, created_at: '2025-01-20T10:00:00Z' },
  { id: '4', first_name: 'Anjali', last_name: 'Mehta', gender: 'female', age: 29, phone: '9634567890', email: 'anjali@email.com', address: 'Pune, Maharashtra', is_active: true, created_at: '2025-02-01T11:00:00Z' },
  { id: '5', first_name: 'Vikram', last_name: 'Singh', gender: 'male', age: 47, phone: '9545678901', email: 'vikram@email.com', address: 'Jaipur, Rajasthan', is_active: true, created_at: '2025-02-10T12:00:00Z' },
  { id: '6', first_name: 'Meena', last_name: 'Joshi', gender: 'female', age: 63, phone: '9456789012', email: 'meena@email.com', address: 'Surat, Gujarat', is_active: true, created_at: '2025-02-15T09:30:00Z' },
]

export const mockCases = [
  { id: '1', patient_id: '1', patient_name: 'Rajesh Sharma', chief_complaint: 'Chronic anxiety with fear of death at night', status: 'active', created_at: '2025-01-12T08:00:00Z', updated_at: '2025-02-01T08:00:00Z' },
  { id: '2', patient_id: '2', patient_name: 'Priya Patel', chief_complaint: 'Recurrent migraines, worse in cold weather', status: 'active', created_at: '2025-01-18T09:00:00Z', updated_at: '2025-02-05T09:00:00Z' },
  { id: '3', patient_id: '3', patient_name: 'Suresh Kumar', chief_complaint: 'Arthritis pain in joints, better with motion', status: 'active', created_at: '2025-01-22T10:00:00Z', updated_at: '2025-02-08T10:00:00Z' },
  { id: '4', patient_id: '4', patient_name: 'Anjali Mehta', chief_complaint: 'Insomnia with restlessness and racing thoughts', status: 'active', created_at: '2025-02-03T11:00:00Z', updated_at: '2025-02-10T11:00:00Z' },
  { id: '5', patient_id: '5', patient_name: 'Vikram Singh', chief_complaint: 'Digestive issues with bloating after meals', status: 'closed', created_at: '2025-02-12T12:00:00Z', updated_at: '2025-02-20T12:00:00Z' },
  { id: '6', patient_id: '6', patient_name: 'Meena Joshi', chief_complaint: 'Chronic fatigue with cold extremities', status: 'active', created_at: '2025-02-16T09:30:00Z', updated_at: '2025-02-22T09:30:00Z' },
]

export const mockPrescriptions = [
  { id: '1', case_id: '1', patient_name: 'Rajesh Sharma', chief_complaint: 'Chronic anxiety with fear of death at night', remedy_name: 'Aconitum Napellus', abbreviation: 'Acon', potency: '200C', dose: '3 pills', frequency: 'Once at bedtime', duration: '7 days', created_at: '2025-01-14T08:00:00Z' },
  { id: '2', case_id: '2', patient_name: 'Priya Patel', chief_complaint: 'Recurrent migraines, worse in cold weather', remedy_name: 'Belladonna', abbreviation: 'Bell', potency: '30C', dose: '5 pills', frequency: 'Three times daily', duration: '5 days', created_at: '2025-01-20T09:00:00Z' },
  { id: '3', case_id: '3', patient_name: 'Suresh Kumar', chief_complaint: 'Arthritis pain in joints, better with motion', remedy_name: 'Rhus Toxicodendron', abbreviation: 'Rhus-t', potency: '1M', dose: '3 pills', frequency: 'Once daily', duration: '14 days', created_at: '2025-01-25T10:00:00Z' },
  { id: '4', case_id: '4', patient_name: 'Anjali Mehta', chief_complaint: 'Insomnia with restlessness and racing thoughts', remedy_name: 'Arsenicum Album', abbreviation: 'Ars', potency: '200C', dose: '3 pills', frequency: 'Once at bedtime', duration: '10 days', created_at: '2025-02-05T11:00:00Z' },
  { id: '5', case_id: '5', patient_name: 'Vikram Singh', chief_complaint: 'Digestive issues with bloating after meals', remedy_name: 'Lycopodium Clavatum', abbreviation: 'Lyc', potency: '30C', dose: '5 pills', frequency: 'Twice daily', duration: '7 days', created_at: '2025-02-14T12:00:00Z' },
  { id: '6', case_id: '6', patient_name: 'Meena Joshi', chief_complaint: 'Chronic fatigue with cold extremities', remedy_name: 'Calcarea Carbonica', abbreviation: 'Calc', potency: '200C', dose: '3 pills', frequency: 'Once weekly', duration: '30 days', created_at: '2025-02-18T09:30:00Z' },
]

export const mockFollowups = [
  { id: '1', case_id: '1', patient_name: 'Rajesh Sharma', chief_complaint: 'Chronic anxiety with fear of death at night', followup_date: '2025-02-14', overall_improvement: 7, symptom_changes: 'Anxiety reduced significantly, sleeping better', action_taken: 'continue', next_followup_date: '2026-03-20', created_at: '2025-02-14T08:00:00Z' },
  { id: '2', case_id: '2', patient_name: 'Priya Patel', chief_complaint: 'Recurrent migraines, worse in cold weather', followup_date: '2025-02-25', overall_improvement: 5, symptom_changes: 'Frequency of migraines reduced from weekly to fortnightly', action_taken: 'repeat', next_followup_date: '2026-03-22', created_at: '2025-02-25T09:00:00Z' },
  { id: '3', case_id: '3', patient_name: 'Suresh Kumar', chief_complaint: 'Arthritis pain in joints, better with motion', followup_date: '2025-03-05', overall_improvement: 6, symptom_changes: 'Morning stiffness reduced, pain less intense', action_taken: 'continue', next_followup_date: '2026-03-25', created_at: '2025-03-05T10:00:00Z' },
  { id: '4', case_id: '4', patient_name: 'Anjali Mehta', chief_complaint: 'Insomnia with restlessness and racing thoughts', followup_date: '2025-03-07', overall_improvement: 8, symptom_changes: 'Sleeping 6-7 hours now, less restlessness', action_taken: 'change_potency', next_followup_date: '2026-03-28', created_at: '2025-03-07T11:00:00Z' },
  { id: '5', case_id: '6', patient_name: 'Meena Joshi', chief_complaint: 'Chronic fatigue with cold extremities', followup_date: '2025-03-10', overall_improvement: 4, symptom_changes: 'Slightly more energy, extremities still cold', action_taken: 'wait', next_followup_date: '2026-04-01', created_at: '2025-03-10T09:30:00Z' },
]
