/**
 * index.js  ·  job-hunter-japan
 *
 * Pipeline:
 *   1. Scrape Indeed JP, Indeed DE, Wantedly, Stepstone
 *   2. Filter by keywords, seniority, tech stack, exclusions
 *   3. Generate personalised cover letter snippets via AI (Anthropic/OpenAI/Ollama)
 *   4. Export results to /results/<timestamp>.csv and .json
 *   5. (Optional) Auto-apply via Playwright browser automation
 *
 * Run:  npm start
 * Apply: APPLY_JOBS=true npm start
 */

require('dotenv').config();

const fs   = require('fs');
const path = require('path');
const { createObjectCsvWriter } = require('csv-writer');

const { scrapeAllSources }          = require('./scraper');
const { filterJobs, printFilterSummary } = require('./filter');
const { addCoverLetters }           = require('./claude-customizer');
const { applyToJobs, DRY_RUN, APPLY_LIMIT } = require('./applier');

// ─── Output helpers ───────────────────────────────────────────────────────────

function getOutputDir() {
  const dir = path.resolve(process.env.OUTPUT_DIR || 'results');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

async function saveCSV(jobs, filePath) {
  const writer = createObjectCsvWriter({
    path: filePath,
    header: [
      { id: 'title',       title: 'JobTitle' },
      { id: 'company',     title: 'Company' },
      { id: 'location',    title: 'Location' },
      { id: 'salary',      title: 'Salary' },
      { id: 'jobUrl',      title: 'JobURL' },
      { id: 'source',      title: 'Source' },
      { id: 'matchedTech', title: 'MatchedTech' },
      { id: 'coverLetter', title: 'CustomizedCoverLetter' },
      { id: 'dateFound',   title: 'DateFound' },
    ],
  });

  const rows = jobs.map((j) => ({
    ...j,
    matchedTech: Array.isArray(j.matchedTech) ? j.matchedTech.join(', ') : '',
  }));

  await writer.writeRecords(rows);
}

function saveJSON(jobs, filePath) {
  fs.writeFileSync(filePath, JSON.stringify(jobs, null, 2), 'utf8');
}

// ─── Progress banner ─────────────────────────────────────────────────────────

function banner(applyMode) {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║       job-hunter-japan  🤖                ║');
  console.log('║  Senior Node.js / Microservices roles     ║');
  console.log('║  Japan  ·  Germany  ·  India              ║');
  if (applyMode) {
  console.log('║  ⚡ AUTO-APPLY MODE ENABLED               ║');
  }
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const APPLY_JOBS = process.env.APPLY_JOBS === 'true';

  banner(APPLY_JOBS);

  // 1. Scrape
  const rawJobs = await scrapeAllSources();

  if (rawJobs.length === 0) {
    console.log('❌ No jobs collected. Check your internet connection and try again.');
    process.exit(1);
  }

  // 2a. Save raw jobs for debugging (always, regardless of filter outcome)
  const outputDir = getOutputDir();
  const rawPath = path.join(outputDir, 'raw_jobs_latest.json');
  saveJSON(rawJobs, rawPath);
  console.log(`🗂  Raw jobs saved → ${path.relative(process.cwd(), rawPath)}\n`);

  // 2b. Print a quick preview of first 5 raw jobs
  console.log('📋 Raw job preview (first 5):');
  rawJobs.slice(0, 5).forEach((j, i) => {
    console.log(`   [${i + 1}] "${j.title}" @ ${j.company} | ${j.location}`);
    console.log(`        desc: ${(j.description || '').slice(0, 120).replace(/\n/g, ' ')}…`);
  });
  console.log('');

  // 2c. Filter
  const filteredJobs = filterJobs(rawJobs);
  printFilterSummary(filteredJobs);

  if (filteredJobs.length === 0) {
    console.log('❌ All jobs were filtered out.');
    console.log(`   Open ${path.relative(process.cwd(), rawPath)} to see raw job data,`);
    console.log('   then adjust REQUIRED_KEYWORDS / SENIORITY_TERMS in src/filter.js.\n');
    process.exit(1);
  }

  // 3. Generate cover letters via AI
  let finalJobs;
  const hasAIKey =
    (process.env.AI_PROVIDER === 'ollama') ||
    (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'your_anthropic_api_key_here') ||
    (process.env.OPENAI_API_KEY    && process.env.OPENAI_API_KEY    !== 'your_openai_api_key_here');

  if (!hasAIKey) {
    console.log('⚠️  No AI provider configured — skipping cover letter generation.');
    console.log('   Set AI_PROVIDER=ollama (free) or add an API key in .env\n');
    finalJobs = filteredJobs.map((j) => ({
      ...j,
      coverLetter: '[Configure AI_PROVIDER in .env to generate cover letters]',
    }));
  } else {
    finalJobs = await addCoverLetters(filteredJobs);
  }

  // 4. Export results
  const ts      = getTimestamp();
  const csvPath = path.join(outputDir, `jobs_${ts}.csv`);
  const jsonPath  = path.join(outputDir, `jobs_${ts}.json`);

  console.log('💾 Saving results...');
  await saveCSV(finalJobs, csvPath);
  saveJSON(finalJobs, jsonPath);

  // 5. Summary
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  ✅  Scrape + filter + cover letters done!                ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Jobs found & filtered : ${String(finalJobs.length).padEnd(32)}║`);
  console.log(`║  CSV  → ${path.relative(process.cwd(), csvPath).padEnd(49)}║`);
  console.log(`║  JSON → ${path.relative(process.cwd(), jsonPath).padEnd(49)}║`);
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

  // Print top match preview
  if (finalJobs.length > 0) {
    const first = finalJobs[0];
    console.log('📌 Top match:');
    console.log(`   Title   : ${first.title}`);
    console.log(`   Company : ${first.company}`);
    console.log(`   Location: ${first.location}`);
    console.log(`   Salary  : ${first.salary}`);
    console.log(`   Tech    : ${(first.matchedTech || []).join(', ')}`);
    if (first.coverLetter && !first.coverLetter.startsWith('[')) {
      console.log('');
      console.log('   Cover letter opener:');
      console.log(`   "${first.coverLetter}"`);
    }
    console.log('');
  }

  // 6. Auto-apply (only if APPLY_JOBS=true)
  if (!APPLY_JOBS) {
    console.log('ℹ️  Auto-apply is OFF. To enable:');
    console.log('   APPLY_JOBS=true npm start\n');
    console.log('   Before enabling, set in .env:');
    console.log('   · APPLICANT_PHONE=+91xxxxxxxxxx');
    console.log('   · RESUME_PATH=/absolute/path/to/resume.pdf');
    console.log('   · APPLY_LIMIT=3   (max jobs per run, default 3)');
    console.log('   · DRY_RUN=false   (default true — safe mode)');
    console.log('   · AUTO_SUBMIT=false (default — always asks you to confirm)\n');
    return;
  }

  // Safety check before applying
  if (!DRY_RUN) {
    console.log('⚠️  DRY_RUN is OFF — the bot WILL attempt real submissions.');
    console.log(`   It will try up to ${APPLY_LIMIT} job(s) this run.\n`);
  }

  await applyToJobs(finalJobs);
}

main().catch((err) => {
  console.error('\n💥 Fatal error:', err.message || err);
  process.exit(1);
});
