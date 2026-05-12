/**
 * index.js  —  job-hunter-japan  (AI agent pipeline)
 *
 * Pipeline:
 *   1. Scrape all sites in sites.json with generic Playwright scraper
 *   2. AI Filter  — Claude/Ollama scores each job against Om's profile
 *   3. AI Prepare — Claude/Ollama generates full application package per job
 *   4. Export      — CSV + JSON to results/
 *   5. Apply       — Playwright auto-apply (opt-in via APPLY_JOBS=true)
 *
 * Run:
 *   npm start               ← scrape + AI filter + prep
 *   APPLY_JOBS=true npm start ← full pipeline including auto-apply
 */

require('dotenv').config();

const fs   = require('fs');
const path = require('path');
const { createObjectCsvWriter } = require('csv-writer');

const { scrapeAllSources }               = require('./scraper');
const { filterJobsWithAI, prepareApplications, tailorResume, CANDIDATE, PROVIDER } = require('./ai-agent');
const { generateAllPDFs }               = require('./resume-pdf');
const { applyToJobs, DRY_RUN, APPLY_LIMIT } = require('./applier');

// ─── Output helpers ───────────────────────────────────────────────────────────

function getOutputDir() {
  const dir = path.resolve(process.env.OUTPUT_DIR || 'results');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function ts() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

async function saveCSV(jobs, filePath) {
  const writer = createObjectCsvWriter({
    path: filePath,
    header: [
      { id: 'title',         title: 'JobTitle' },
      { id: 'company',       title: 'Company' },
      { id: 'location',      title: 'Location' },
      { id: 'country',       title: 'Country' },
      { id: 'salary',        title: 'Salary' },
      { id: 'aiScore',       title: 'AIScore' },
      { id: 'aiReason',      title: 'AIReason' },
      { id: 'matchedSkills', title: 'MatchedSkills' },
      { id: 'coverLetter',   title: 'CoverLetter' },
      { id: 'emailSubject',  title: 'EmailSubject' },
      { id: 'jobUrl',        title: 'JobURL' },
      { id: 'source',        title: 'Source' },
      { id: 'dateFound',     title: 'DateFound' },
    ],
  });

  const rows = jobs.map(j => ({
    ...j,
    matchedSkills: (j.matchedSkills || []).join(', '),
    coverLetter:   j.applicationPackage?.coverLetter   || '',
    emailSubject:  j.applicationPackage?.emailSubject  || '',
  }));

  await writer.writeRecords(rows);
}

function saveJSON(data, filePath) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// ─── Banner ───────────────────────────────────────────────────────────────────

function banner(applyMode) {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   job-hunter-japan  🤖  AI Agent Pipeline    ║');
  console.log(`║   AI: ${(PROVIDER + ' / ' + require('./ai-agent').PROVIDER).slice(0,38).padEnd(38)}║`);
  console.log(`║   Candidate: ${CANDIDATE.name.padEnd(31)}║`);
  if (applyMode) {
  console.log('║   ⚡ AUTO-APPLY MODE ON                       ║');
  }
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const APPLY_JOBS = process.env.APPLY_JOBS === 'true';
  banner(APPLY_JOBS);

  const outputDir = getOutputDir();

  // ── 1. Scrape ──────────────────────────────────────────────────────────────
  const rawJobs = await scrapeAllSources();

  // Always save raw jobs for inspection
  saveJSON(rawJobs, path.join(outputDir, 'raw_jobs_latest.json'));
  console.log(`🗂  Raw jobs → results/raw_jobs_latest.json (${rawJobs.length} jobs)\n`);

  if (rawJobs.length === 0) {
    console.log('❌ No jobs collected. Check sites.json and your internet connection.');
    process.exit(1);
  }

  // ── 1b. Pre-filter obvious junk before spending AI tokens ──────────────────
  const JUNK_TITLES = /^(humans only|join linkedin|\d[\d,+]+ .* jobs|developer jobs in|software developer jobs for|in person developer|partially remote|fully remote developer|english.friendly|^\s*$)/i;
  const cleanJobs = rawJobs.filter(j => {
    if (!j.title || JUNK_TITLES.test(j.title)) return false;
    if (!j.company && !j.description) return false;  // no data at all
    return true;
  });
  const removed = rawJobs.length - cleanJobs.length;
  if (removed > 0) console.log(`🧹 Pre-filter removed ${removed} junk/empty listings → ${cleanJobs.length} remain\n`);

  // ── 2. AI Filter ───────────────────────────────────────────────────────────
  const matchedJobs = await filterJobsWithAI(cleanJobs);

  if (matchedJobs.length === 0) {
    console.log('❌ No jobs passed the AI filter.');
    console.log('   Try lowering AI_FILTER_THRESHOLD in .env (default: 6)');
    console.log('   or add more sites to sites.json.\n');
    process.exit(1);
  }

  // ── 3. AI Application Package ──────────────────────────────────────────────
  const preparedJobs = await prepareApplications(matchedJobs);

  // ── 3b. AI Resume Tailoring (if resume.txt / RESUME_TEXT_PATH exists) ──────
  const resumeTextPath = process.env.RESUME_TEXT_PATH ||
                         path.resolve(__dirname, '..', 'resume.txt');
  let resumeText = null;
  if (fs.existsSync(resumeTextPath)) {
    resumeText = fs.readFileSync(resumeTextPath, 'utf8');
    console.log(`📄 Resume loaded from ${path.relative(process.cwd(), resumeTextPath)}`);
  } else {
    console.log('ℹ️  No resume.txt found — skipping resume tailoring.');
    console.log('   Add your resume to resume.txt (plain text) to enable this feature.\n');
  }

  const finalJobs = resumeText
    ? await tailorResume(preparedJobs, resumeText)
    : preparedJobs;

  // Generate ATS-optimised PDF resumes (one per matched job)
  if (resumeText) {
    const resumeDir = path.join(outputDir, 'resumes');
    await generateAllPDFs(finalJobs, resumeDir);
  }

  // ── 4. Export ──────────────────────────────────────────────────────────────
  const stamp    = ts();
  const csvPath  = path.join(outputDir, `jobs_${stamp}.csv`);
  const jsonPath = path.join(outputDir, `jobs_${stamp}.json`);

  console.log('💾 Saving results...');
  await saveCSV(finalJobs, csvPath);
  saveJSON(finalJobs, jsonPath);

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  ✅  Done!                                                ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Raw scraped        : ${String(rawJobs.length).padEnd(34)}║`);
  const threshold = process.env.AI_FILTER_THRESHOLD || '6';
  console.log(`║  AI matched (>=${threshold})     : ${String(matchedJobs.length).padEnd(34)}║`);
  console.log(`║  CSV  → ${path.relative(process.cwd(), csvPath).padEnd(49)}║`);
  console.log(`║  JSON → ${path.relative(process.cwd(), jsonPath).padEnd(49)}║`);
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // Preview top match
  if (preparedJobs.length > 0) {
    const top = preparedJobs[0];
    console.log(`📌 Top match: ${top.title} @ ${top.company}  [AI score: ${top.aiScore}/10]`);
    console.log(`   ${top.aiReason}`);
    const cl = top.applicationPackage?.coverLetter;
    if (cl) {
      console.log('\n   Cover letter (first paragraph):');
      console.log('   ' + cl.split('\n')[0]);
    }
    console.log('');
  }

  // ── 5. Auto-Apply (opt-in) ─────────────────────────────────────────────────
  if (!APPLY_JOBS) {
    console.log('ℹ️  Auto-apply is OFF.  To enable: APPLY_JOBS=true npm start');
    console.log('   Set in .env: APPLICANT_PHONE, RESUME_PATH, APPLY_LIMIT, DRY_RUN\n');
    return;
  }

  // Pass cover letter into the field applier expects
  const applyReady = finalJobs.map(j => ({
    ...j,
    coverLetter: j.applicationPackage?.coverLetter || '',
  }));

  await applyToJobs(applyReady);
}

main().catch(err => {
  console.error('\n💥 Fatal error:', err.message || err);
  process.exit(1);
});
