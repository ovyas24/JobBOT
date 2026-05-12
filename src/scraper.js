/**
 * scraper.js  —  Generic Playwright job scraper
 *
 * Works on ANY job board URL. No hardcoded site-specific selectors.
 *
 * Algorithm per URL:
 *   1. Load page with headless Chromium
 *   2. Collect all links that look like individual job postings
 *   3. Visit each job detail page
 *   4. Extract structured data via JSON-LD (fastest) or raw page text
 *      (which ai-agent.js then parses with Claude)
 *   5. Return raw job objects — filtering is done by AI, not here
 *
 * Add / remove sites in sites.json — no code changes needed.
 */

const fs      = require('fs');
const path    = require('path');
const cheerio = require('cheerio');

const MAX_PER_SITE  = parseInt(process.env.MAX_JOBS_PER_SOURCE || '15', 10);
const PAGE_DELAY_MS = parseInt(process.env.REQUEST_DELAY_MS    || '700',  10);

// ─── Shared helpers ───────────────────────────────────────────────────────────

function makeJob(overrides) {
  return {
    title:       '',
    company:     '',
    location:    '',
    salary:      'Not listed',
    description: '',
    jobUrl:      '',
    source:      '',
    country:     'Japan',
    dateFound:   new Date().toISOString().split('T')[0],
    rawText:     '',   // full page text — AI agent uses this if structured fields are sparse
    ...overrides,
  };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Heuristic: does this href look like an individual job posting?
 * True for  /jobs/senior-engineer-123  or  /companies/acme/jobs/backend
 * False for /jobs  /jobs/nodejs  /careers  /about
 */
function looksLikeJobDetailUrl(href = '') {
  const lower = href.toLowerCase();

  // Must have a slug after the keyword segment (length > 1 path component)
  const jobPatterns = [
    /\/jobs\/[^/]{4,}/,
    /\/job\/[^/]{4,}/,
    /\/positions\/[^/]{4,}/,
    /\/position\/[^/]{4,}/,
    /\/openings\/[^/]{4,}/,
    /\/opening\/[^/]{4,}/,
    /\/careers\/[^/]{4,}/,
    /\/companies\/[^/]+\/jobs\/[^/]{4,}/,
    /\/apply\/[^/]{4,}/,
  ];

  return jobPatterns.some(re => re.test(lower));
}

// ─── Extract job data from a loaded detail page ───────────────────────────────

function extractFromPage($, jobUrl, source, country) {
  // Try JSON-LD first — most modern job boards embed full structured data
  let job = null;

  $('script[type="application/ld+json"]').each((_, el) => {
    if (job) return;
    try {
      const data  = JSON.parse($(el).html() || '{}');
      const items = Array.isArray(data) ? data : [data];
      items.forEach(item => {
        if (item['@type'] === 'JobPosting' && !job) {
          const minSal = item.baseSalary?.value?.minValue;
          const maxSal = item.baseSalary?.value?.maxValue;
          const cur    = item.baseSalary?.currency || '';
          job = makeJob({
            title:       item.title || '',
            company:     item.hiringOrganization?.name || '',
            location:    item.jobLocation?.address?.addressLocality ||
                         item.jobLocation?.address?.addressCountry  || '',
            salary:      minSal ? `${cur} ${minSal}–${maxSal}` : 'Not listed',
            description: (item.description || '')
                           .replace(/<[^>]+>/g, ' ')
                           .replace(/\s+/g, ' ')
                           .trim()
                           .slice(0, 1500),
            jobUrl,
            source,
            country,
          });
        }
      });
    } catch { /* skip bad JSON */ }
  });

  if (job) return job;

  // HTML fallback — grab h1, meta description, and all visible body text
  const title    = $('h1').first().text().trim() || $('h2').first().text().trim();
  const company  = $('meta[property="og:site_name"]').attr('content') ||
                   $('[class*="company"],[class*="employer"],[class*="organization"]').first().text().trim() || '';
  const salary   = $('[class*="salary"],[class*="compensation"],[class*="pay"]').first().text().trim() || 'Not listed';
  const location = $('[class*="location"],[class*="city"],[class*="region"]').first().text().trim() || '';
  const metaDesc = $('meta[name="description"]').attr('content') || '';

  // Collect all paragraph text for AI to reason over
  const paragraphs = [];
  $('main p, article p, section p, .description p, [class*="content"] p').each((_, el) => {
    const t = $(el).text().trim();
    if (t.length > 30) paragraphs.push(t);
  });
  const bodyText = paragraphs.join('\n').slice(0, 2000) || metaDesc;

  if (!title) return null;

  return makeJob({ title, company, location, salary, description: metaDesc.slice(0, 500), rawText: bodyText, jobUrl, source, country });
}

// ─── Single-site scraper ──────────────────────────────────────────────────────

async function scrapeSite(page, site) {
  const { name, url, country = 'Japan' } = site;
  const results = [];

  console.log(`  📡 ${name}`);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2000);

    const listingHtml = await page.content();
    const $listing    = cheerio.load(listingHtml);

    // Collect all unique job detail URLs from the listing page
    const seen    = new Set();
    const jobUrls = [];

    $listing('a[href]').each((_, el) => {
      const href = $listing(el).attr('href') || '';
      if (!looksLikeJobDetailUrl(href)) return;
      const full = href.startsWith('http') ? href : new URL(href, url).href;
      if (!seen.has(full)) { seen.add(full); jobUrls.push(full); }
    });

    // If the listing page itself looks like a job detail (direct job URL passed)
    if (jobUrls.length === 0 && looksLikeJobDetailUrl(url)) {
      const job = extractFromPage($listing, url, name, country);
      if (job) results.push(job);
      return results;
    }

    const toVisit = jobUrls.slice(0, MAX_PER_SITE);
    console.log(`     🔗 ${jobUrls.length} job links found — enriching ${toVisit.length}`);

    for (const jobUrl of toVisit) {
      try {
        await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await sleep(500);

        const $ = cheerio.load(await page.content());
        const job = extractFromPage($, jobUrl, name, country);
        if (job) results.push(job);

        await sleep(PAGE_DELAY_MS);
      } catch (err) {
        console.warn(`     ⚠️  ${jobUrl}: ${err.message}`);
      }
    }

  } catch (err) {
    console.warn(`     ⚠️  Could not load ${url}: ${err.message}`);
  }

  console.log(`     ✅ ${results.length} jobs extracted`);
  return results;
}

// ─── Main export ──────────────────────────────────────────────────────────────

async function scrapeAllSources() {
  // Load sites from sites.json
  const sitesPath = path.resolve(__dirname, '..', 'sites.json');
  let sites = [];
  try {
    sites = JSON.parse(fs.readFileSync(sitesPath, 'utf8'));
  } catch {
    console.warn('⚠️  sites.json not found — using default TokyoDev URLs');
    sites = [
      { name: 'TokyoDev Node.js', url: 'https://www.tokyodev.com/jobs/nodejs', country: 'Japan' },
      { name: 'TokyoDev Backend', url: 'https://www.tokyodev.com/jobs/backend', country: 'Japan' },
    ];
  }

  console.log(`\n🔍 Scraping ${sites.length} site(s) with headless Chromium...\n`);

  let playwright;
  try {
    playwright = require('playwright');
  } catch {
    throw new Error(
      'Playwright not installed.\n  Run: npm install playwright && npx playwright install chromium'
    );
  }

  // Debug dir for screenshots
  const debugDir = path.resolve(process.env.OUTPUT_DIR || 'results', 'debug');
  if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });

  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-US',
  });
  const page = await context.newPage();

  const allJobs = [];

  for (const site of sites) {
    const jobs = await scrapeSite(page, site);
    allJobs.push(...jobs);
    await sleep(1000);
  }

  await browser.close();

  // Deduplicate by URL
  const deduped = Array.from(
    new Map(allJobs.map(j => [j.jobUrl, j])).values()
  );

  console.log(`\n📋 ${deduped.length} unique raw jobs collected across all sites\n`);
  return deduped;
}

module.exports = { scrapeAllSources };
