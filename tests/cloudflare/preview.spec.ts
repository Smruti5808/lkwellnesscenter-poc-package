import { test, expect } from '@playwright/test';

for (const [email, role] of [['ananya@example.com','patient'], ['padmanaban@example.com','doctor'], ['admin@example.com','admin']]) {
  test(`${role} portal signs in and loads on the complete Cloudflare Worker`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/login');
    await expect(page.getByText(email, {exact:true})).toBeVisible();
    await page.getByLabel('Email or phone').fill(email);
    await page.getByLabel('PIN').fill('1234');
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await page.waitForURL(new RegExp(`/${role}$`));
    await expect(page.locator('.app-header')).toBeVisible();
    const session = await page.request.get('/api/v1/auth/session');
    expect(session.status()).toBe(200);
    expect((await session.json()).data.user.role).toBe(role);
    await page.reload();
    await expect(page.locator('.app-header')).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('new patients register with a persistent session on Cloudflare', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('Full name').fill('Cloud Demo Patient');
  await page.getByLabel('Date of birth').fill('1990-02-03');
  await page.getByLabel('Gender').selectOption('female');
  await page.getByLabel('Email').fill('cloud.patient@example.com');
  await page.getByLabel('Mobile number').fill('+91 90000 55444');
  await page.getByLabel('I accept the terms').check();
  await page.getByRole('button', {name:'Create account'}).click();
  await page.waitForURL(/\/patient$/);
  await expect(page.getByRole('heading',{name:'Hello, Cloud'})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading',{name:'Hello, Cloud'})).toBeVisible();
});

test('private PDFs, uploads, exports and shared records work through the deployed routing', async ({ request }) => {
  const origin = 'http://127.0.0.1:3300';
  const login = await request.post('/api/v1/auth/login',{headers:{origin},data:{identifier:'ananya@example.com',pin:'1234'}});
  expect(login.status()).toBe(200);
  const documents = await request.get('/api/v1/c/documents');
  expect(documents.status()).toBe(200);
  const seed = (await documents.json()).data.find((doc:{storage:string}) => doc.storage === 'seed');
  expect(seed).toBeTruthy();
  const file = await request.get(`/api/v1/documents/${seed.id}/file`);
  expect(file.status()).toBe(200);
  expect((await file.body()).subarray(0,5).toString()).toBe('%PDF-');
  expect(file.headers()['x-content-type-options']).toBe('nosniff');
  const bytes = Buffer.from('%PDF-1.4\n% Cloudflare smoke test');
  const upload = await request.post('/api/v1/documents/upload',{headers:{origin},multipart:{file:{name:'demo.pdf',mimeType:'application/pdf',buffer:bytes},patientId:'pat-ananya',title:'Cloudflare prescription',category:'prescription',documentDate:'2026-10-02'}});
  expect(upload.status()).toBe(201);
  const doc = (await upload.json()).data;
  expect(await (await request.get(`/api/v1/documents/${doc.id}/file`)).body()).toEqual(bytes);
  const exported = await request.get('/api/v1/privacy/export');
  expect(exported.status()).toBe(200);
  expect((await exported.json()).documents.some((row:{id:string}) => row.id === doc.id)).toBe(true);
  expect((await request.delete(`/api/v1/c/documents/${doc.id}`,{headers:{origin}})).status()).toBe(200);
  expect((await request.get(`/api/v1/documents/${doc.id}/file`)).status()).toBe(404);
});
