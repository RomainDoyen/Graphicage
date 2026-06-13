import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: '.',
    timeout: 120_000,
    retries: process.env.CI ? 1 : 0,
    use: {
        baseURL: 'http://127.0.0.1:8000',
        trace: 'on-first-retry',
    },
});
