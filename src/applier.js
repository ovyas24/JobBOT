/**
 * applier.js
 * Browser-based job applier using Playwright.
 *
 * Flow per job:
 *   1. Open Chromium (headed) and navigate to the job URL
 *   2. Detect site type: Indeed Apply | Wantedly | Generic
 *   3. Attempt to auto-fill phone, resume, and cover letter
 *   4. Pause and ask YOU to confirm before anything is submitted
 *   5. Log the result (applied | skipped | manual | error)
 *   6. Save application log to results/applications_<timestamp>.json
 *
 * Safety switches (all in .env):
 *   DRY_RUN=true        → opens browser but never clicks Submit
 *   APPLY_LIMIT=3       → max jobs per run (default 3)
 *   AUTO_SUBMIT=false   → default false — always asks you to confirm
 */

const fs   = require('fs');
const path = require('path');
const readline = require('readline');

// ─── Config from .env ─────────────────────────────────────────────────────────

const DRY_RUN     = process.env.DRY_RUN     !== 'false'; // default TRUE (safe)
const AUTO_SUBMIT = process.env.AUTO_SUBMIT === 'true';  // default FALSE
const APPLY_LIMIT = parseInt(process.env.APPLY_LIMIT || '3', 10);

const APPLICANT = {
  name:     process.env.APPLICANT_NAME  || 'Om Prakash Vyas',
  email:    process.env.APPLICANT_EMAIL || 'ovyas24@gmail.com',
  phone:    process.env.APPLICANT_PHONE || '',           // set in .env
  linkedin: process.env.APPLICANT_LINKEDIN || 'https://www.linkedin.com/in/om-prakash-vyas-68b9a2160',
  resumePath: process.env.RESUME_PATH   || '',           // absolute path to resume PDF
};

// ─── Readline helper for terminal prompts ────────────────────────────────────

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

// ─── Playwright launcher ──────────────────────────────────────────────────────

async function launchBrowser() {
  let playwright;
  try {
    playwright = require('playwright');
  } catch {
    throw new Error(
      'Playwright not installed.\n' +
      '  Run:  npm install playwright && npx playwright install chromium'
    );
  }

  const browser = await playwright.chromium.launch({
    headless: false,  // headed so you can see and interact
    slowMo: 150,      // human-like timing
    args: ['--start-maximized'],
  });

  const context = await browser.newContext({
    viewport: null,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });

  return { browser, context };
}

// ─── Site-specific apply handlers ────────────────────────────────────────────

/** Indeed Japan / Germany — tries the "Indeed Apply" quick-apply widget */
async function applyIndeed(page, job) {
  const log = [];

  // Wait for apply button (various selectors Indeed uses)
  const applySelectors = [
    '[data-testid="applyButton"]',
    '[id*="apply-button"]',
    '.ia-IndeedApplyButton',
    'button:has-text("Apply now")',
    'button:has-text("Indeed Apply")',
    'a:has-text("Apply now")',
  ];

  let applyBtn = null;
  for (const sel of applySelectors) {
    try {
      applyBtn = await page.waitForSelector(sel, { timeout: 4000 });
      if (applyBtn) break;
    } catch { /* try next */ }
  }

  if (!applyBtn) {
    log.push('No Indeed Apply button detected — may redirect to company ATS');
    return { success: false, log };
  }

  log.push('Found Indeed Apply button');

  if (DRY_RUN) {
    log.push('[DRY_RUN] Would click Apply — skipped');
    return { success: false, dryRun: true, log };
  }

  await applyBtn.click();
  await page.waitForTimeout(2000);

  // Phone field
  if (APPLICANT.phone) {
    const phoneField = await page.$('input[name*="phone"], input[type="tel"]');
    if (phoneField) {
      await phoneField.fill(APPLICANT.phone);
      log.push('Filled phone number');
    }
  }

  // Resume upload
  if (APPLICANT.resumePath && fs.existsSync(APPLICANT.resumePath)) {
    const fileInput = await page.$('input[type="file"]');
    if (fileInput) {
      await fileInput.setInputFiles(APPLICANT.resumePath);
      log.push('Uploaded resume');
      await page.waitForTimeout(2000);
    }
  }

  // Cover letter textarea
  if (job.coverLetter && !job.coverLetter.startsWith('[')) {
    const coverField = await page.$(
      'textarea[name*="cover"], textarea[placeholder*="cover"], textarea[aria-label*="cover"]'
    );
    if (coverField) {
      await coverField.fill(job.coverLetter);
      log.push('Filled cover letter');
    }
  }

  return { success: true, log, requiresConfirm: true };
}

/** Wantedly — clicks "Want to Visit" / Apply and fills message */
async function applyWantedly(page, job) {
  const log = [];

  const btnSelectors = [
    'button:has-text("Want to Visit")',
    'button:has-text("Apply")',
    'a:has-text("Want to Visit")',
    '[class*="wantToVisit"]',
    '[data-target*="apply"]',
  ];

  let btn = null;
  for (const sel of btnSelectors) {
    try {
      btn = await page.waitForSelector(sel, { timeout: 4000 });
      if (btn) break;
    } catch { /* try next */ }
  }

  if (!btn) {
    log.push('No Wantedly apply button found');
    return { success: false, log };
  }

  log.push('Found Wantedly apply button');

  if (DRY_RUN) {
    log.push('[DRY_RUN] Would click button — skipped');
    return { success: false, dryRun: true, log };
  }

  await btn.click();
  await page.waitForTimeout(2000);

  // Message / motivation textarea
  if (job.coverLetter && !job.coverLetter.startsWith('[')) {
    const msgField = await page.$(
      'textarea[name*="message"], textarea[placeholder*="motivation"], textarea'
    );
    if (msgField) {
      await msgField.fill(job.coverLetter);
      log.push('Filled motivation / cover message');
    }
  }

  return { success: true, log, requiresConfirm: true };
}

/** Generic fallback — opens page, copies cover letter, waits for you */
async function applyGeneric(page, job) {
  const log = ['Generic site — browser opened at job page'];

  // Copy cover letter to clipboard via page evaluate
  if (job.coverLetter && !job.coverLetter.startsWith('[')) {
    try {
      await page.evaluate((text) => navigator.clipboard?.writeText(text), job.coverLetter);
      log.push('Cover letter copied to clipboard — paste it in the application form');
    } catch {
      log.push('Could not auto-copy — cover letter printed below for manual copy');
    }
  }

  return { success: false, manual: true, log };
}

// ─── Core apply function for a single job ────────────────────────────────────

async function applyToJob(browser, context, job, idx, total) {
  console.log(`\n  [${ idx }/${ total }] ${job.title} @ ${job.company}`);
  console.log(`        URL: ${job.jobUrl}`);

  const result = {
    title:    job.title,
    company:  job.company,
    location: job.location,
    jobUrl:   job.jobUrl,
    status:   'pending',
    log:      [],
    appliedAt: null,
  };

  const page = await context.newPage();

  try {
    await page.goto(job.jobUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1500);

    const url = page.url();
    let applyResult;

    if (url.includes('indeed.com') || url.includes('indeed.co.jp')) {
      applyResult = await applyIndeed(page, job);
    } else if (url.includes('wantedly.com')) {
      applyResult = await applyWantedly(page, job);
    } else {
      applyResult = await applyGeneric(page, job);
    }

    result.log.push(...(applyResult.log || []));

    // ── Dry run ──────────────────────────────────────────────
    if (applyResult.dryRun) {
      console.log('     [DRY_RUN] Browser opened but form not submitted.');
      console.log('     Set DRY_RUN=false in .env to enable real submissions.');
      result.status = 'dry_run';
      await page.waitForTimeout(3000);
      await page.close();
      return result;
    }

    // ── Manual-only site ─────────────────────────────────────
    if (applyResult.manual) {
      if (job.coverLetter && !job.coverLetter.startsWith('[')) {
        console.log('\n     📋 Cover letter to paste:');
        console.log('     ─────────────────────────────────────────────────');
        console.log(`     ${job.coverLetter}`);
        console.log('     ─────────────────────────────────────────────────');
      }
      const answer = await ask('\n     Browser is open. Did you apply? (y/n/skip): ');
      result.status = answer === 'y' ? 'applied' : answer === 'skip' ? 'skipped' : 'not_applied';
      if (result.status === 'applied') result.appliedAt = new Date().toISOString();
      await page.close();
      return result;
    }

    // ── Form was filled — confirm before submit ───────────────
    if (applyResult.requiresConfirm) {
      console.log('     ✅ Form auto-filled. Review the browser window.');
      result.log.forEach((l) => console.log(`        · ${l}`));

      if (AUTO_SUBMIT) {
        // Find and click the final submit button
        const submitBtn = await page.$(
          'button[type="submit"], button:has-text("Submit"), button:has-text("Send application")'
        );
        if (submitBtn) {
          await submitBtn.click();
          await page.waitForTimeout(2000);
          console.log('     🚀 Application submitted (AUTO_SUBMIT=true)');
          result.status  = 'applied';
          result.appliedAt = new Date().toISOString();
        } else {
          console.log('     ⚠️  Submit button not found — please click it manually');
          await ask('     Press Enter after submitting manually: ');
          result.status = 'applied';
          result.appliedAt = new Date().toISOString();
        }
      } else {
        const answer = await ask('\n     Review the form above. Submit? (y=submit / n=skip / m=mark-manual): ');
        if (answer === 'y') {
          const submitBtn = await page.$(
            'button[type="submit"], button:has-text("Submit"), button:has-text("Send application")'
          );
          if (submitBtn) {
            await submitBtn.click();
            await page.waitForTimeout(2000);
            console.log('     🚀 Submitted!');
          } else {
            console.log('     ⚠️  Submit button not found — please click it in the browser');
            await ask('     Press Enter once you have submitted: ');
          }
          result.status  = 'applied';
          result.appliedAt = new Date().toISOString();
        } else if (answer === 'm') {
          result.status = 'manual_required';
        } else {
          result.status = 'skipped';
        }
      }
    }

  } catch (err) {
    console.warn(`     ⚠️  Error: ${err.message}`);
    result.status = 'error';
    result.log.push(`Error: ${err.message}`);
  } finally {
    try { await page.close(); } catch { /* ignore */ }
  }

  return result;
}

// ─── Main batch applier ───────────────────────────────────────────────────────

async function applyToJobs(jobs = []) {
  if (jobs.length === 0) {
    console.log('  ℹ️  No jobs to apply to.');
    return [];
  }

  if (DRY_RUN) {
    console.log('\n🔒 DRY_RUN=true  — browser will open but nothing will be submitted.');
    console.log('   Set DRY_RUN=false in .env when you\'re ready to go live.\n');
  }

  const toApply = jobs.slice(0, APPLY_LIMIT);
  console.log(`\n🚀 Starting auto-apply for ${toApply.length} job(s) (limit: ${APPLY_LIMIT})...\n`);

  if (!DRY_RUN && !AUTO_SUBMIT) {
    console.log('ℹ️  AUTO_SUBMIT=false — you will be asked to confirm each submission.\n');
  }

  // Warn if no phone set
  if (!APPLICANT.phone) {
    console.log('⚠️  APPLICANT_PHONE not set in .env — phone fields will be blank.\n');
  }

  // Warn if no resume set
  if (!APPLICANT.resumePath) {
    console.log('⚠️  RESUME_PATH not set in .env — resume upload will be skipped.\n');
  }

  let browser, context;
  const applicationLog = [];

  try {
    ({ browser, context } = await launchBrowser());

    for (let i = 0; i < toApply.length; i++) {
      const result = await applyToJob(browser, context, toApply[i], i + 1, toApply.length);
      applicationLog.push(result);

      const icon =
        result.status === 'applied'          ? '✅' :
        result.status === 'dry_run'          ? '🔒' :
        result.status === 'skipped'          ? '⏭️ ' :
        result.status === 'manual_required'  ? '✋' :
        result.status === 'error'            ? '❌' : '❓';
      console.log(`     ${icon} Status: ${result.status}`);

      // Pause between applications
      if (i < toApply.length - 1) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
  }

  // Save application log
  const outputDir = path.resolve(process.env.OUTPUT_DIR || 'results');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const ts      = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const logPath = path.join(outputDir, `applications_${ts}.json`);
  fs.writeFileSync(logPath, JSON.stringify(applicationLog, null, 2), 'utf8');

  // Summary
  const counts = applicationLog.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  console.log('\n📊 Apply session summary:');
  Object.entries(counts).forEach(([status, count]) => {
    const icon =
      status === 'applied'         ? '✅' :
      status === 'dry_run'         ? '🔒' :
      status === 'skipped'         ? '⏭️ ' :
      status === 'manual_required' ? '✋' :
      status === 'error'           ? '❌' : '❓';
    console.log(`   ${icon}  ${status}: ${count}`);
  });
  console.log(`\n💾 Application log saved → ${path.relative(process.cwd(), logPath)}\n`);

  return applicationLog;
}

module.exports = { applyToJobs, APPLICANT, DRY_RUN, APPLY_LIMIT };
