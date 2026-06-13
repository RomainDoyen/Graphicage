import { test, expect } from '@playwright/test';

async function signUp(page) {
    const username = `e2e_${Date.now()}`;
    await page.goto('/compte/inscription/');
    await page.locator('#id_username').fill(username);
    await page.locator('#id_email').fill(`${username}@example.com`);
    await page.locator('#id_password1').fill('SecurePass123!');
    await page.locator('#id_password2').fill('SecurePass123!');
    await page.locator('button[type=submit]').click();
    await page.waitForURL('**/app/**', { timeout: 15_000 });
    return username;
}

test('landing page affiche les CTA inscription', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('Optimisez vos tournées');
    await expect(page.getByRole('link', { name: /Créer un compte|Commencer gratuitement/i }).first()).toBeVisible();
});

test('charge l\'exemple et calcule un itinéraire', async ({ page }) => {
    await signUp(page);

    await page.locator('#btn-load-sample').click();
    await expect(page.locator('#point-count')).not.toHaveText('0', { timeout: 15_000 });

    await page.locator('#use-road-routing').uncheck();

    await page.locator('#btn-solve').click();
    await expect(page.locator('.route-card')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.results-summary')).toBeVisible();
});
