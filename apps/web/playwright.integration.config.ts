import {defineConfig} from '@playwright/test';
/** Explicit opt-in; ordinary browser projects do not load this fixture. */
export default defineConfig({testDir:'./tests/browser',testMatch:'real-api.spec.ts',fullyParallel:false,workers:1,retries:0,timeout:120_000,globalTimeout:300_000,reporter:'list',outputDir:'test-results/real-api',use:{browserName:'chromium',channel:process.env.PLAYWRIGHT_CHANNEL,launchOptions:{timeout:180_000},viewport:{width:1280,height:900},locale:'en-US',trace:'off',screenshot:'off',video:'off'}});
