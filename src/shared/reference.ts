// Built-in reference data used by the consultation workspace. Demo content only — not clinical guidance.

export type DrugInfo = { name: string; drugClass: string; strengths: string[]; maxDailyMg?: number; defaultDose: string; defaultFrequency: 'OD' | 'BD' | 'TDS' | 'QID' | 'HS' | 'SOS' };

export const DRUGS: DrugInfo[] = [
  { name: 'Paracetamol', drugClass: 'Analgesic', strengths: ['500 mg', '650 mg'], maxDailyMg: 4000, defaultDose: '500 mg', defaultFrequency: 'TDS' },
  { name: 'Ibuprofen', drugClass: 'NSAID', strengths: ['200 mg', '400 mg'], maxDailyMg: 2400, defaultDose: '400 mg', defaultFrequency: 'TDS' },
  { name: 'Aspirin', drugClass: 'NSAID', strengths: ['75 mg', '150 mg'], maxDailyMg: 4000, defaultDose: '75 mg', defaultFrequency: 'OD' },
  { name: 'Amoxicillin', drugClass: 'Penicillin antibiotic', strengths: ['250 mg', '500 mg'], maxDailyMg: 3000, defaultDose: '500 mg', defaultFrequency: 'TDS' },
  { name: 'Azithromycin', drugClass: 'Macrolide antibiotic', strengths: ['250 mg', '500 mg'], maxDailyMg: 500, defaultDose: '500 mg', defaultFrequency: 'OD' },
  { name: 'Metformin', drugClass: 'Biguanide', strengths: ['500 mg', '1000 mg'], maxDailyMg: 2550, defaultDose: '500 mg', defaultFrequency: 'BD' },
  { name: 'Amlodipine', drugClass: 'Calcium channel blocker', strengths: ['5 mg', '10 mg'], maxDailyMg: 10, defaultDose: '5 mg', defaultFrequency: 'OD' },
  { name: 'Atorvastatin', drugClass: 'Statin', strengths: ['10 mg', '20 mg', '40 mg'], maxDailyMg: 80, defaultDose: '10 mg', defaultFrequency: 'HS' },
  { name: 'Warfarin', drugClass: 'Anticoagulant', strengths: ['1 mg', '5 mg'], maxDailyMg: 10, defaultDose: '5 mg', defaultFrequency: 'OD' },
  { name: 'Cetirizine', drugClass: 'Antihistamine', strengths: ['10 mg'], maxDailyMg: 10, defaultDose: '10 mg', defaultFrequency: 'HS' },
  { name: 'Omeprazole', drugClass: 'Proton pump inhibitor', strengths: ['20 mg', '40 mg'], maxDailyMg: 40, defaultDose: '20 mg', defaultFrequency: 'OD' },
  { name: 'Salbutamol inhaler', drugClass: 'Bronchodilator', strengths: ['100 mcg/puff'], defaultDose: '2 puffs', defaultFrequency: 'SOS' },
];

/** Pairs of drug names or drug classes that should prompt a caution. */
export const INTERACTIONS: { a: string; b: string; severity: 'caution' | 'serious'; note: string }[] = [
  { a: 'Warfarin', b: 'NSAID', severity: 'serious', note: 'increased bleeding risk' },
  { a: 'Warfarin', b: 'Macrolide antibiotic', severity: 'caution', note: 'may raise anticoagulant effect' },
  { a: 'Atorvastatin', b: 'Macrolide antibiotic', severity: 'caution', note: 'may raise statin levels' },
];

export const FREQUENCY_PER_DAY: Record<string, number> = { OD: 1, BD: 2, TDS: 3, QID: 4, HS: 1, SOS: 4 };
export const FREQUENCY_LABEL: Record<string, string> = { OD: 'Once daily', BD: 'Twice daily', TDS: 'Three times daily', QID: 'Four times daily', HS: 'At bedtime', SOS: 'As needed' };

export const ICD10: { code: string; label: string }[] = [
  { code: 'Z00.0', label: 'General adult medical examination' },
  { code: 'J06.9', label: 'Acute upper respiratory infection, unspecified' },
  { code: 'J02.9', label: 'Acute pharyngitis, unspecified' },
  { code: 'J45.9', label: 'Asthma, unspecified' },
  { code: 'I10', label: 'Essential (primary) hypertension' },
  { code: 'E11.9', label: 'Type 2 diabetes mellitus without complications' },
  { code: 'E78.5', label: 'Hyperlipidaemia, unspecified' },
  { code: 'E03.9', label: 'Hypothyroidism, unspecified' },
  { code: 'K21.9', label: 'Gastro-oesophageal reflux disease without oesophagitis' },
  { code: 'K30', label: 'Functional dyspepsia' },
  { code: 'M54.5', label: 'Low back pain' },
  { code: 'M17.9', label: 'Osteoarthritis of knee, unspecified' },
  { code: 'R51', label: 'Headache' },
  { code: 'R50.9', label: 'Fever, unspecified' },
  { code: 'L20.9', label: 'Atopic dermatitis, unspecified' },
  { code: 'N39.0', label: 'Urinary tract infection, site not specified' },
  { code: 'F41.1', label: 'Generalized anxiety disorder' },
  { code: 'G43.9', label: 'Migraine, unspecified' },
  { code: 'D50.9', label: 'Iron deficiency anaemia, unspecified' },
  { code: 'B34.9', label: 'Viral infection, unspecified' },
];

export const SOAP_TEMPLATES: { name: string; subjective: string; objective: string; assessment: string; plan: string }[] = [
  { name: 'General follow-up', subjective: 'Patient reports ', objective: 'General condition stable. Vitals reviewed.', assessment: '', plan: 'Continue current plan. Review in 4 weeks.' },
  { name: 'Upper respiratory infection', subjective: 'Sore throat, cough and runny nose for __ days. No breathlessness.', objective: 'Throat congested. Chest clear on auscultation.', assessment: 'Likely viral upper respiratory infection.', plan: 'Symptomatic care, fluids and rest. Return if fever persists beyond 3 days.' },
  { name: 'Hypertension review', subjective: 'Here for blood pressure review. Adherent to medication.', objective: 'BP __/__ mmHg. Pulse regular.', assessment: 'Hypertension, control reviewed.', plan: 'Continue medication. Reduce salt intake. Home BP log. Review in 3 months.' },
  { name: 'Diabetes review', subjective: 'Routine diabetes review. No hypoglycaemic episodes reported.', objective: 'Weight __ kg. Feet examined.', assessment: 'Type 2 diabetes, review of control.', plan: 'Continue medication. HbA1c ordered. Diet counselling. Review with results.' },
];

export const QUICK_TEXT = ['No known drug allergies confirmed.', 'Advised plenty of fluids and rest.', 'Return immediately if symptoms worsen.', 'Medication side effects explained.', 'Lifestyle advice given: diet, exercise, sleep.', 'Patient understands and agrees with the plan.'];

export const SPECIALTIES = ['Integrative Expert Practitioner', 'General Physician', 'Cardiology', 'Dermatology', 'Endocrinology', 'Paediatrics', 'Orthopaedics', 'Gynaecology', 'Psychiatry'];
export const LANGUAGES = ['English', 'Hindi', 'Kannada', 'Tamil', 'Telugu', 'Malayalam', 'Marathi', 'Bengali'];
export const EMERGENCY_NUMBER = '112';
