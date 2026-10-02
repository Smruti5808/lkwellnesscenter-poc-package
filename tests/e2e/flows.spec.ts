import { expect, test } from '@playwright/test';
import { ACCOUNTS, newPage, readData, registerDoctor, resetData, signIn } from './support';

test.beforeEach(resetData);

test('patient finds a doctor, books with intake, and the doctor accepts', async ({ browser }) => {
  const { page: patient, errors } = await newPage(browser, ACCOUNTS.meera);
  await patient.locator('.main-nav').getByRole('link', { name: 'Find a doctor' }).click();
  await expect(patient.locator('.doctor-card')).toHaveCount(1);
  await patient.getByLabel('Specialty').selectOption('Dermatology');
  await expect(patient.getByText('No doctors match these filters')).toBeVisible();
  await patient.getByLabel('Specialty').selectOption('Integrative Expert Practitioner');
  await patient.getByLabel('Max fee (₹)').fill('500');
  await expect(patient.locator('.doctor-card')).toHaveCount(0); // lowest fee is ₹600
  await patient.getByLabel('Max fee (₹)').fill('');
  await patient.locator('.doctor-card', { hasText: 'Dr. Padmanaban' }).getByRole('link', { name: 'View & book' }).click();
  await patient.getByLabel('Appointment type').selectOption({ label: 'Integrative consultation · 30 min · ₹1,000' });
  await patient.getByLabel('Reason for visit').fill('Dry patches on hands');
  await patient.locator('.slot-picker .chip.time').nth(2).click();
  await patient.getByLabel('Main concern').fill('Dry patches on hands');
  await patient.getByLabel('I have a fever').check();
  await patient.getByRole('button', { name: /^Request / }).click();
  await patient.waitForURL(/\/patient\/appointments/);
  const row = patient.locator('.row.appt', { hasText: 'Dr. Padmanaban' }).filter({ hasText: 'Dry patches' });
  await expect(row).toContainText('requested');

  const { page: doctor } = await newPage(browser, ACCOUNTS.doctor);
  await doctor.locator('.main-nav').getByRole('link', { name: 'Schedule' }).click();
  const booking = doctor.locator('.row', { hasText: 'Dry patches' }).filter({ has: doctor.getByRole('button', { name: 'Accept' }) }).first();
  await booking.getByRole('button', { name: 'Accept' }).first().click();
  await expect(doctor.getByText('Booking accepted.')).toBeVisible();

  await patient.reload();
  await expect(patient.locator('.row.appt', { hasText: 'Dry patches' })).toContainText('confirmed');
  await patient.locator('.bell').click();
  await expect(patient.getByText('Appointment confirmed')).toBeVisible();
  expect(errors).toEqual([]);
});

test('doctor runs a consultation: SOAP, ICD-10, safety-checked e-prescription, order, finalize; patient sees it', async ({ browser }) => {
  const { page: doctor, errors } = await newPage(browser, ACCOUNTS.doctor);
  const queueRow = doctor.locator('.row.queue', { hasText: 'Ananya Rao' });
  await queueRow.getByRole('button', { name: 'Check in' }).click();
  await expect(queueRow).toContainText('checked-in');
  await queueRow.getByRole('button', { name: 'Start consult' }).click();
  await doctor.waitForURL(/\/doctor\/consult\//);
  await expect(doctor.getByLabel('S — Subjective')).toHaveValue(/BP review/); // prefilled from intake answers

  await doctor.getByLabel('Apply template').selectOption('Hypertension review');
  await doctor.getByLabel('O — Objective').fill('BP 130/84 mmHg. Pulse regular.');
  await doctor.getByLabel('P — Plan').click();
  await doctor.getByRole('button', { name: '+ Patient understands and agrees with the plan.' }).click();
  await expect(doctor.getByLabel('P — Plan')).toHaveValue(/agrees with the plan/);
  await doctor.getByLabel('Search code or term').fill('hypert');
  await doctor.getByRole('button', { name: /I10 Essential/ }).click();
  await expect(doctor.locator('.chip.active', { hasText: 'I10' })).toBeVisible();
  await doctor.getByRole('button', { name: 'Save notes' }).click();
  await expect(doctor.getByText('Notes saved.')).toBeVisible();
  await expect(doctor.locator('.workspace-head').getByText('unsaved')).toHaveCount(0);

  // Prescription with a penicillin-class drug triggers the allergy check; signing needs acknowledgement.
  await doctor.getByRole('button', { name: 'New prescription' }).click();
  const dialog = doctor.getByRole('dialog');
  await dialog.getByLabel('Medicine', { exact: true }).fill('Amoxicillin');
  await expect(dialog.getByLabel('Dose')).toHaveValue('500 mg');
  await expect(dialog.locator('.warnings')).toContainText('Penicillin allergy');
  await expect(dialog.getByRole('button', { name: 'Sign & issue' })).toBeDisabled();
  await dialog.getByLabel('Medicine', { exact: true }).fill('Azithromycin');
  await expect(dialog.locator('.warnings')).toContainText('Atorvastatin'); // interaction with current statin
  await dialog.getByLabel('I have reviewed these warnings').check();
  await dialog.getByRole('button', { name: 'Sign & issue' }).click();
  await expect(doctor.locator('.card', { hasText: 'Prescriptions' }).getByText('Azithromycin 500 mg')).toBeVisible();

  await doctor.locator('.card', { hasText: 'Lab & imaging orders' }).getByRole('button', { name: 'Add order' }).click();
  await doctor.getByRole('dialog').getByRole('textbox', { name: 'Test' }).fill('Serum creatinine');
  await doctor.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(doctor.getByText('Serum creatinine')).toBeVisible();

  await doctor.getByRole('button', { name: 'Generate from notes' }).click();
  await expect(doctor.getByLabel('Care summary')).toHaveValue(/Azithromycin/);
  await doctor.getByRole('button', { name: 'Finalize & share' }).click();
  await expect(doctor.getByText('Consultation finalized and shared')).toBeVisible();
  await doctor.getByRole('button', { name: 'Complete visit' }).click();
  await expect(doctor.getByText('Visit marked complete.')).toBeVisible();

  const { page: patient } = await newPage(browser, ACCOUNTS.ananya);
  await patient.locator('.main-nav').getByRole('link', { name: 'Visits & results' }).click();
  await expect(patient.locator('.timeline-item', { hasText: 'Azithromycin' }).first()).toBeVisible(); // all-records timeline
  await patient.getByRole('tab', { name: 'Visit history' }).click();
  await expect(patient.locator('.card').first()).toContainText('Azithromycin');
  await patient.getByRole('tab', { name: 'Prescriptions' }).click();
  await patient.locator('.row', { hasText: 'Azithromycin' }).getByRole('link', { name: 'View / download' }).click();
  await expect(patient.locator('.prescription')).toContainText('DEMO-REG-0001');
  await expect(patient.locator('.signature')).toContainText('Digitally signed by Dr. Padmanaban');
  await patient.locator('.main-nav').getByRole('link', { name: 'Appointments' }).click();
  await patient.getByRole('tab', { name: 'Past & cancelled' }).click();
  const visit = patient.locator('.row.appt', { hasText: 'BP review' });
  await visit.getByRole('button', { name: 'Rate visit' }).click();
  await patient.getByRole('dialog').getByLabel('Rating').selectOption('5');
  await patient.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(visit).toContainText('★★★★★');
  expect(errors).toEqual([]);
});

test('patient manages the health profile: create, edit, delete, vitals, adherence, upload', async ({ browser }) => {
  const { page, errors } = await newPage(browser, ACCOUNTS.ananya);
  await page.locator('.main-nav').getByRole('link', { name: 'Health profile' }).click();
  await page.getByRole('tab', { name: 'Allergies' }).click();
  await page.getByRole('button', { name: 'Add allergy' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Type').selectOption('drug');
  await dialog.getByLabel('Substance').fill('Sulfa drugs');
  await dialog.getByLabel('Severity').selectOption('severe');
  await dialog.getByRole('button', { name: 'Save' }).click();
  const row = page.locator('.row', { hasText: 'Sulfa drugs' });
  await expect(row).toContainText('severe');
  await row.getByRole('button', { name: 'Edit allergy' }).click();
  await page.getByRole('dialog').getByLabel('Reaction').fill('Hives');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(row).toContainText('Hives');
  await row.getByRole('button', { name: 'Delete allergy' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('.row', { hasText: 'Sulfa drugs' })).toHaveCount(0);

  await page.getByRole('tab', { name: 'Vitals' }).click();
  await page.getByRole('button', { name: 'Add vitals reading' }).click();
  await page.getByRole('dialog').getByLabel('BP systolic (mmHg)').fill('124');
  await page.getByRole('dialog').getByLabel('BP diastolic (mmHg)').fill('82');
  await page.getByRole('dialog').getByLabel('SpO₂ (%)').fill('99');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.card', { hasText: 'Latest vitals' })).toContainText('124/82 mmHg');

  await page.getByRole('tab', { name: 'Medications' }).click();
  const today = page.locator('.adherence tbody tr', { hasText: 'Amlodipine' }).locator('button.dose').last();
  await today.click();
  await expect(today).toHaveClass(/taken/);
  await today.click();
  await expect(today).toHaveClass(/missed/);

  await page.getByRole('tab', { name: 'Documents' }).click();
  await page.getByRole('button', { name: 'Upload a document' }).click();
  const upload = page.getByRole('dialog');
  await upload.locator('input[type=file]').setInputFiles({ name: 'cbc.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% demo\n') });
  await upload.getByLabel('Title').fill('Complete blood count');
  await upload.getByLabel('Type').selectOption('lab');
  await upload.getByLabel('Report date').fill('2026-09-30');
  await upload.getByRole('button', { name: 'Upload' }).click();
  await expect(page.locator('.row', { hasText: 'Complete blood count' })).toBeVisible();
  const data = await readData();
  expect(data.documents.find(d => d.title === 'Complete blood count')?.storage).toBe('upload');
  expect(errors).toEqual([]);
});

test('privacy: blocking a doctor removes access; export works; account deletion removes data', async ({ browser }) => {
  const { page, errors } = await newPage(browser, ACCOUNTS.ananya);
  await page.locator('.main-nav').getByRole('link', { name: 'Privacy' }).click();
  await expect(page.locator('.table')).toContainText('Dr. Padmanaban'); // access log
  await page.getByRole('button', { name: 'Add blocked doctor' }).click();
  await page.getByRole('dialog').getByLabel('Doctor').selectOption({ label: 'Dr. Padmanaban · Integrative Expert Practitioner' });
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.row', { hasText: 'Dr. Padmanaban' })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download my data (JSON)' }).click();
  expect(JSON.parse(await (await (await download).createReadStream()).toArray().then(c => Buffer.concat(c).toString())).patients.length).toBe(2);

  const { page: doctor } = await newPage(browser, ACCOUNTS.doctor);
  await doctor.goto('/doctor/patients');
  await expect(doctor.locator('.rows').getByText('Vikram Shah')).toBeVisible();
  await expect(doctor.locator('.rows').getByText('Ananya Rao')).toHaveCount(0);
  const blocked = await doctor.request.get('/api/v1/patients/pat-ananya/summary');
  expect(blocked.status()).toBe(404);

  const { page: meera } = await newPage(browser, ACCOUNTS.meera);
  await meera.locator('.main-nav').getByRole('link', { name: 'Privacy' }).click();
  await meera.getByRole('button', { name: 'Delete my account and data' }).click();
  await meera.getByRole('dialog').getByLabel('Type DELETE to confirm').fill('DELETE');
  await meera.getByRole('dialog').getByRole('button', { name: 'Delete everything' }).click();
  await meera.waitForURL(/\/login/);
  await meera.getByLabel('Email or phone').fill(ACCOUNTS.meera);
  await meera.getByLabel('PIN').fill('1234');
  await meera.getByRole('button', { name: 'Sign in' }).click();
  await expect(meera.getByText('Account or PIN not recognised')).toBeVisible();
  const data = await readData();
  expect(data.patients.some(p => p.id === 'pat-meera')).toBe(false);
  expect(data.appointments.some(a => a.patientId === 'pat-meera')).toBe(false);
  expect(errors).toEqual([]);
});

test('admin verifies a pending doctor, who then appears in patient search', async ({ browser }) => {
  await registerDoctor(browser, 'Dr Test Extra');
  const { page: admin, errors } = await newPage(browser, ACCOUNTS.admin);
  await admin.locator('.main-nav').getByRole('link', { name: 'Doctor verification' }).click();
  await admin.locator('.card', { hasText: 'Dr Test Extra' }).getByRole('button', { name: 'Verify' }).click();
  await admin.getByRole('tab', { name: /Verified/ }).click();
  await expect(admin.locator('.card', { hasText: 'Dr Test Extra' })).toBeVisible();
  const { page: patient } = await newPage(browser, ACCOUNTS.ananya);
  await patient.locator('.main-nav').getByRole('link', { name: 'Find a doctor' }).click();
  await expect(patient.locator('.doctor-card', { hasText: 'Dr Test Extra' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('new patient registers and lands in the portal', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('Full name').fill('Kiran Patel');
  await page.getByLabel('Date of birth').fill('1990-02-03');
  await page.getByLabel('Gender').selectOption('female');
  await page.getByLabel('Email').fill('kiran@example.com');
  await page.getByLabel('Mobile number').fill('+91 90000 55555');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/register$/); // the required terms checkbox blocks submission
  expect(await page.getByLabel('I accept the terms').evaluate(el => (el as HTMLInputElement).validity.valueMissing)).toBe(true);
  await page.getByLabel('I accept the terms').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL(/\/patient$/);
  await expect(page.getByRole('heading', { name: 'Hello, Kiran' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL(/\/login$/); // let the app's own redirect finish before navigating again
  await signIn(page, '+91 90000 55555');
  await expect(page).toHaveURL(/\/patient$/);
});

test('patient and doctor exchange secure messages', async ({ browser }) => {
  const { page: patient, errors } = await newPage(browser, ACCOUNTS.ananya);
  await patient.locator('.main-nav').getByRole('link', { name: 'Messages' }).click();
  await patient.getByRole('button', { name: /Dr\. Padmanaban/ }).click();
  await patient.getByLabel('Message', { exact: true }).fill('Can I take my BP tablet with breakfast?');
  await patient.getByRole('button', { name: 'Send' }).click();
  await expect(patient.locator('.bubble.mine').last()).toContainText('breakfast');

  const { page: doctor } = await newPage(browser, ACCOUNTS.doctor);
  await doctor.locator('.main-nav').getByRole('link', { name: 'Messages' }).click();
  await doctor.getByRole('button', { name: /Ananya Rao/ }).click();
  await expect(doctor.locator('.bubble').last()).toContainText('breakfast');
  await doctor.getByLabel('Message', { exact: true }).fill('Yes, after breakfast is fine.');
  await doctor.getByRole('button', { name: 'Send' }).click();
  await patient.reload();
  await patient.getByRole('button', { name: /Dr\. Padmanaban/ }).click();
  await expect(patient.locator('.bubble').last()).toContainText('after breakfast is fine');
  await expect(patient.locator('.bubble.mine').last()).toContainText('read');
  expect(errors).toEqual([]);
});

test('health records: patient uploads a prescription; the timeline filters it; the doctor sees it', async ({ browser }) => {
  const { page, errors } = await newPage(browser, ACCOUNTS.ananya);
  await page.locator('.main-nav').getByRole('link', { name: 'Visits & results' }).click();
  await expect(page.locator('.timeline-item', { hasText: 'Prescription: allergic rhinitis' })).toBeVisible(); // seeded sample
  await page.getByRole('tab', { name: 'Prescriptions' }).click();
  const uploaded = page.locator('.card', { hasText: 'Uploaded prescriptions' });
  await uploaded.getByRole('button', { name: 'Upload prescription' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('input[type=file]').setInputFiles({ name: 'rx.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') });
  await dialog.getByLabel('Title').fill('Prescription: migraine');
  await dialog.getByLabel('Prescription date').fill('2026-09-01');
  await dialog.getByLabel('Prescribed by (doctor or hospital)').fill('Dr. Walk-in, City Clinic');
  await dialog.getByRole('button', { name: 'Upload' }).click();
  await expect(uploaded.locator('.row', { hasText: 'Prescription: migraine' })).toContainText('Dr. Walk-in, City Clinic');

  await page.getByRole('tab', { name: 'All records' }).click();
  await page.locator('.records-tools').getByRole('button', { name: /^Prescriptions/ }).click();
  await expect(page.locator('.timeline-item', { hasText: 'Prescription: migraine' })).toBeVisible();
  await expect(page.locator('.timeline-item', { hasText: 'Lipid profile' })).toHaveCount(0);
  await page.getByLabel('Search records').fill('atorvastatin');
  await expect(page.locator('.timeline-item')).toHaveCount(1);
  expect((await readData()).documents.find(d => d.title === 'Prescription: migraine')?.category).toBe('prescription');

  const { page: doctor } = await newPage(browser, ACCOUNTS.doctor);
  await doctor.goto('/doctor/patients/pat-ananya');
  await doctor.getByRole('tab', { name: 'Health records' }).click();
  await expect(doctor.locator('.timeline-item', { hasText: 'Prescription: migraine' })).toContainText('Dr. Walk-in, City Clinic');
  await expect(doctor.locator('.timeline-item', { hasText: 'Lipid profile (LDL cholesterol)' })).toContainText('Outside range');
  expect(errors).toEqual([]);
});
