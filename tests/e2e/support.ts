import path from 'node:path';
import { expect, type Browser, type Page } from '@playwright/test';
import { E2E } from '../../playwright.config';
import { makeSeedData } from '../../demo/seed-data';
import { JsonStore } from '../../src/server/store';
import type { Data } from '../../src/shared/schemas';

export const store = new JsonStore(path.resolve(E2E.dataDir, 'app-data.json'));
export const resetData = async () => { await store.seed(makeSeedData(), true); };
export const readData = () => store.transaction((d: Data) => d);

export const ACCOUNTS = { ananya: 'ananya@example.com', vikram: 'vikram@example.com', meera: 'meera@example.com', doctor: 'padmanaban@example.com', admin: 'admin@example.com' };

/** The dummy data has one doctor. Tests that need another register one (pending verification) in a fresh browser context. */
export async function registerDoctor(browser: Browser, name = 'Dr Test Extra', email = 'extra.doctor@example.com') {
  const context = await browser.newContext();
  const res = await context.request.post('/api/v1/auth/register/doctor', { headers: { origin: E2E.origin }, data: { name, email, phone: '+91 80000 11111', councilNumber: 'X-1', licenseNumber: 'L-1', specialty: 'Dermatology', qualifications: 'MBBS', languages: ['English'], clinic: 'Clinic' } });
  expect(res.status()).toBe(201);
  return { page: await context.newPage(), email };
}

/** Fails the test on uncaught page errors and console errors. */
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|status of 40[134]/.test(m.text())) errors.push(`console: ${m.text()}`); });
  return errors;
}

export async function signIn(page: Page, email: string, home?: RegExp) {
  await page.goto('/login');
  await page.getByLabel('Email or phone').fill(email);
  await page.getByLabel('PIN').fill('1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(home ?? /\/(patient|doctor|admin)$/);
  await expect(page.locator('.app-header')).toBeVisible();
}

export async function newPage(browser: Browser, email: string, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = watchErrors(page);
  await signIn(page, email);
  return { page, errors };
}
