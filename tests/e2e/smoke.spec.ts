import { expect, test } from '@playwright/test';
import { ACCOUNTS, newPage, registerDoctor, resetData } from './support';

test.beforeEach(resetData);

const PAGES: Record<string, { email: string; paths: string[] }> = {
  patient: { email: ACCOUNTS.ananya, paths: ['/patient', '/patient/health', '/patient/doctors', '/patient/doctors/doc-padmanaban', '/patient/appointments', '/patient/records', '/patient/prescriptions/rx-ananya-2', '/patient/messages', '/patient/privacy', '/patient/profile', '/patient/notifications'] },
  doctor: { email: ACCOUNTS.doctor, paths: ['/doctor', '/doctor/schedule', '/doctor/patients', '/doctor/patients/pat-ananya', '/doctor/consult/cns-ananya-2', '/doctor/prescriptions/rx-ananya-2', '/doctor/messages', '/doctor/referrals', '/doctor/performance', '/doctor/profile', '/doctor/notifications'] },
  admin: { email: ACCOUNTS.admin, paths: ['/admin', '/admin/doctors', '/admin/users', '/admin/notifications'] },
};

for (const [role, { email, paths }] of Object.entries(PAGES)) {
  for (const width of [1280, 390]) {
    test(`${role} pages render without errors at ${width}px`, async ({ browser }) => {
      const { page, errors } = await newPage(browser, email, { width, height: 900 });
      for (const path of paths) {
        await page.goto(path);
        await expect(page.locator('.loading')).toHaveCount(0, { timeout: 15_000 });
        await expect(page.getByText('This page does not exist.'), path).toHaveCount(0);
        await expect(page.locator('.notice-error'), `${path} shows an error`).toHaveCount(0);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${path} scrolls horizontally at ${width}px`).toBeLessThanOrEqual(0);
        if (process.env.QA_SCREENSHOTS) await page.screenshot({ path: `${process.env.QA_SCREENSHOTS}/${role}-${width}${path.replaceAll('/', '_')}.png`, fullPage: true });
      }
      expect(errors).toEqual([]);
    });
  }
}

test('pending doctor sees verification notice', async ({ browser }) => {
  const { page } = await registerDoctor(browser);
  await page.goto('/doctor');
  await expect(page.getByText('awaiting admin verification')).toBeVisible();
});
