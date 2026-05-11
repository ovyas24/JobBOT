/**
 * index.js  ·  job-hunter-japan
 *
 * Pipeline:
 *   1. Scrape Indeed JP, Indeed DE, Wantedly, Stepstone
 *   2. Filter by keywords, seniority, tech stack, exclusions
 *   3. Generate personalised cover letter snippets via Claude API
 *   4. Export results to /results/<timestamp>.csv and .json
 *
 * Run:  npm start
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { createObjectCsvWriter } = require('csv-writer');

const { scrapeAllSources } = require('./scraper');
const { filterJobs, printFilterSummary } = require('./filter');
const { addCoverLetters } = require('./claude-customizer');

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

function banner() {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║       job-hunter-japan  🤖                ║');
  console.log('║  Senior Node.js / Microservices roles     ║');
  console.log('║  Japan  ·  Germany  ·  India              ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  banner();

  // 1. Scrape
  const rawJobs = await scrapeAllSources();

  if (rawJobs.length === 0) {
    console.log('❌ No jobs collected. Check your internet connection and try again.');
    process.exit(1);
  }

  // 2. Filter
  const filteredJobs = filterJobs(rawJobs);
  printFilterSummary(filteredJobs);

  if (filteredJobs.length === 0) {
    console.log('❌ All jobs were filtered out. Adjust criteria in src/filter.js and re-run.');
    process.exit(1);
  }

  // 3. Generate cover letters via Claude
  let finalJobs;
  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'your_anthropic_api_key_here') {
    console.log('⚠️  ANTHROPIC_API_KEY not set — skipping cover letter generation.');
    console.log('   Set it in .env and re-run to get personalised cover letters.\n');
    finalJobs = filteredJobs.map((j) => ({
      ...j,
      coverLetter: '[Add ANTHROPIC_API_KEY to .env to generate cover letters]',
    }));
  } else {
    finalJobs = await addCoverLetters(filteredJobs);
  }

  // 4. Export results
  const outputDir = getOutputDir();
  const ts = getTimestamp();
  const csvPath = path.join(outputDir, `jobs_${ts}.csv`);
  const jsonPath = path.join(outputDir, `jobs_${ts}.json`);

  console.log('💾 Saving results...');
  await saveCSV(finalJobs, csvPath);
  saveJSON(finalJobs, jsonPath);

  // 5. Summary
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  ✅  Done!                                                ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Jobs found & filtered : ${String(finalJobs.length).padEnd(32)}║`);
  console.log(`║  CSV  → ${path.relative(process.cwd(), csvPath).padEnd(49)}║`);
  console.log(`║  JSON → ${path.relative(process.cwd(), jsonPath).padEnd(49)}║`);
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

  // Print a quick preview of the first result
  if (finalJobs.length > 0) {
    const first = finalJobs[0];
    console.log('📌 Top match preview:');
    console.log(`   Title   : ${first.title}`);
    console.log(`   Company : ${first.company}`);
    console.log(`   Location: ${first.location}`);
    console.log(`   Salary  : ${first.salary}`);
    console.log(`   Tech    : ${(first.matchedTech || []).join(', ')}`);
    if (first.coverLetter && !first.coverLetter.startsWith('[')) {
      console.log('');
      console.log('   Cover letter snippet:');
      console.log(`   "${first.coverLetter}"`);
    }
    console.log('');
  }
}

main().catch((err) => {
  console.error('\n💥 Fatal error:', err.message || err);
  process.exit(1);
});
