/**
 * scraper.js
 * Fetches tech job listings from:
 *   - Indeed Japan  (indeed.co.jp)
 *   - Indeed Germany (de.indeed.com)
 *   - Wantedly      (wantedly.com) via public search
 *   - Stepstone     (stepstone.de)
 *
 * NOTE: Public job sites regularly change their HTML structure.
 *       If a scraper stops returning results, update the CSS selectors
 *       in the corresponding parse* function below.
 *
 *       For production use, consider the official Indeed Publisher API
 *       (https://publisher.indeed.com) which is more reliable.
 */

const axios = require('axios');
const cheerio = require('cheerio');

// ─── Shared helpers ───────────────────────────────────────────────────────────

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  Accept:
    'text/html,application/xhtml+xml,application/xhtml+xml,' +
    'application/xml;q=0.9,image/webp,*/*;q=0.8',
};

const REQUEST_DELAY_MS = parseInt(process.env.REQUEST_DELAY_MS || '1500', 10);
const MAX_PER_SOURCE = parseInt(process.env.MAX_JOBS_PER_SOURCE || '20', 10);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchHTML(url) {
  try {
    const response = await axios.get(url, {
      headers: HEADERS,
      timeout: 15000,
    });
    return response.data;
  } catch (err) {
    console.warn(`  ⚠️  Could not fetch ${url}: ${err.message}`);
    return null;
  }
}

/** Build a sanitised job object with consistent shape */
function makeJob(overrides) {
  return {
    title: '',
    company: '',
    location: '',
    salary: 'Not listed',
    description: '',
    jobUrl: '',
    source: '',
    dateFound: new Date().toISOString().split('T')[0],
    ...overrides,
  };
}

// ─── Indeed Japan ─────────────────────────────────────────────────────────────

async function scrapeIndeedJapan(keywords = 'Node.js backend') {
  console.log('  📡 Scraping Indeed Japan...');
  const results = [];
  const query = encodeURIComponent(keywords);
  const url = `https://jp.indeed.com/jobs?q=${query}&l=Japan&lang=en`;

  const html = await fetchHTML(url);
  if (!html) return results;

  const $ = cheerio.load(html);

  // Indeed wraps each card in a <div class="job_seen_beacon"> or similar;
  // the stable data-jk attribute uniquely identifies each job.
  $('div[data-jk], li[data-jk]').each((_, el) => {
    if (results.length >= MAX_PER_SOURCE) return false;

    const jk = $(el).attr('data-jk') || '';
    const title =
      $(el).find('h2.jobTitle span, [data-testid="jobTitle"] span').first().text().trim() ||
      $(el).find('h2, h3').first().text().trim();
    const company =
      $(el).find('[data-testid="company-name"], .companyName').first().text().trim();
    const location =
      $(el).find('[data-testid="text-location"], .companyLocation').first().text().trim();
    const salary =
      $(el).find('[data-testid="attribute_snippet_testid"], .salary-snippet-container').first().text().trim() ||
      'Not listed';
    const description =
      $(el).find('.job-snippet, [data-testid="jobDescriptionText"]').first().text().trim();

    if (!title || !company) return;

    results.push(
      makeJob({
        title,
        company,
        location: location || 'Japan',
        salary,
        description,
        jobUrl: jk ? `https://jp.indeed.com/viewjob?jk=${jk}` : url,
        source: 'Indeed Japan',
      })
    );
  });

  console.log(`     ✅ Indeed Japan: ${results.length} jobs found`);
  return results;
}

// ─── Indeed Germany ───────────────────────────────────────────────────────────

async function scrapeIndeedGermany(keywords = 'Node.js backend') {
  console.log('  📡 Scraping Indeed Germany...');
  const results = [];
  const query = encodeURIComponent(keywords);
  const url = `https://de.indeed.com/jobs?q=${query}&l=Deutschland&lang=en`;

  const html = await fetchHTML(url);
  if (!html) return results;

  const $ = cheerio.load(html);

  $('div[data-jk], li[data-jk]').each((_, el) => {
    if (results.length >= MAX_PER_SOURCE) return false;

    const jk = $(el).attr('data-jk') || '';
    const title =
      $(el).find('h2.jobTitle span, [data-testid="jobTitle"] span').first().text().trim() ||
      $(el).find('h2, h3').first().text().trim();
    const company =
      $(el).find('[data-testid="company-name"], .companyName').first().text().trim();
    const location =
      $(el).find('[data-testid="text-location"], .companyLocation').first().text().trim();
    const salary =
      $(el).find('[data-testid="attribute_snippet_testid"], .salary-snippet-container').first().text().trim() ||
      'Not listed';
    const description =
      $(el).find('.job-snippet, [data-testid="jobDescriptionText"]').first().text().trim();

    if (!title || !company) return;

    results.push(
      makeJob({
        title,
        company,
        location: location || 'Germany',
        salary,
        description,
        jobUrl: jk ? `https://de.indeed.com/viewjob?jk=${jk}` : url,
        source: 'Indeed Germany',
      })
    );
  });

  console.log(`     ✅ Indeed Germany: ${results.length} jobs found`);
  return results;
}

// ─── Wantedly ─────────────────────────────────────────────────────────────────
// Wantedly has a public JSON-based search endpoint for stories/projects.

async function scrapeWantedly(keywords = 'Node.js') {
  console.log('  📡 Scraping Wantedly...');
  const results = [];

  const query = encodeURIComponent(keywords);
  const url = `https://www.wantedly.com/projects?q=${query}&page=1`;

  const html = await fetchHTML(url);
  if (!html) return results;

  const $ = cheerio.load(html);

  // Wantedly renders project cards; selectors reflect their current markup.
  $('article, .ProjectCard, [class*="project-card"], [class*="ProjectCard"]').each((_, el) => {
    if (results.length >= MAX_PER_SOURCE) return false;

    const title =
      $(el).find('h2, h3, [class*="title"]').first().text().trim();
    const company =
      $(el).find('[class*="company"], [class*="Company"]').first().text().trim() ||
      $(el).find('p').first().text().trim();
    const location =
      $(el).find('[class*="location"], [class*="Location"]').first().text().trim() || 'Japan';
    const description =
      $(el).find('p, [class*="description"]').first().text().trim();
    const relHref = $(el).find('a').first().attr('href') || '';
    const jobUrl = relHref.startsWith('http')
      ? relHref
      : `https://www.wantedly.com${relHref}`;

    if (!title) return;

    results.push(
      makeJob({
        title,
        company: company || 'Unknown',
        location,
        description,
        jobUrl,
        source: 'Wantedly',
      })
    );
  });

  // Fallback: try JSON-LD embedded data
  if (results.length === 0) {
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const data = JSON.parse($(el).html() || '{}');
        const items = Array.isArray(data) ? data : [data];
        items.forEach((item) => {
          if (item['@type'] === 'JobPosting' && results.length < MAX_PER_SOURCE) {
            results.push(
              makeJob({
                title: item.title || '',
                company: item.hiringOrganization?.name || '',
                location: item.jobLocation?.address?.addressLocality || 'Japan',
                salary:
                  item.baseSalary?.value?.value
                    ? `${item.baseSalary.currency || ''} ${item.baseSalary.value.value}`
                    : 'Not listed',
                description: item.description?.slice(0, 300) || '',
                jobUrl: item.url || '',
                source: 'Wantedly',
              })
            );
          }
        });
      } catch (_) {}
    });
  }

  console.log(`     ✅ Wantedly: ${results.length} jobs found`);
  return results;
}

// ─── Stepstone Germany ────────────────────────────────────────────────────────

async function scrapeStepstone(keywords = 'Node.js Backend') {
  console.log('  📡 Scraping Stepstone Germany...');
  const results = [];

  const query = encodeURIComponent(keywords);
  const url = `https://www.stepstone.de/jobs/${query}/in-deutschland`;

  const html = await fetchHTML(url);
  if (!html) return results;

  const $ = cheerio.load(html);

  // Stepstone uses article tags with data-at="job-item"
  $('article[data-at="job-item"], article[class*="ResultList"]').each((_, el) => {
    if (results.length >= MAX_PER_SOURCE) return false;

    const title = $(el).find('[data-at="job-item-title"]').text().trim() ||
      $(el).find('h2, h3').first().text().trim();
    const company = $(el).find('[data-at="job-item-company-name"]').text().trim() ||
      $(el).find('[class*="company"]').first().text().trim();
    const location = $(el).find('[data-at="job-item-location"]').text().trim() ||
      $(el).find('[class*="location"]').first().text().trim() || 'Germany';
    const salary = $(el).find('[data-at="job-item-salary"]').text().trim() || 'Not listed';
    const relHref = $(el).find('a').first().attr('href') || '';
    const jobUrl = relHref.startsWith('http')
      ? relHref
      : `https://www.stepstone.de${relHref}`;

    if (!title) return;

    results.push(
      makeJob({
        title,
        company: company || 'Unknown',
        location,
        salary,
        jobUrl,
        source: 'Stepstone Germany',
      })
    );
  });

  console.log(`     ✅ Stepstone Germany: ${results.length} jobs found`);
  return results;
}

// ─── Demo / Fallback data ─────────────────────────────────────────────────────
// When live scrapers return 0 results (bot detection, network block, etc.)
// the bot injects realistic sample jobs so the pipeline can still be tested
// end-to-end, including Claude cover letter generation and CSV/JSON export.

function getSampleJobs() {
  return [
    makeJob({
      title: 'Senior Backend Engineer (Node.js)',
      company: 'Mercari Japan',
      location: 'Tokyo, Japan',
      salary: '¥12,000,000 – ¥16,000,000 / year',
      description:
        'Build and scale our microservices platform handling millions of daily transactions. ' +
        'You will work with Node.js, MongoDB, Kubernetes, and AWS. ' +
        '5+ years of backend experience required. Experience with React is a plus.',
      jobUrl: 'https://careers.mercari.com/job/senior-backend-engineer',
      source: 'Sample Data',
    }),
    makeJob({
      title: 'Lead Software Engineer – Full Stack',
      company: 'SmartNews',
      location: 'Tokyo, Japan',
      salary: '¥13,000,000 – ¥18,000,000 / year',
      description:
        'Lead a team of 6 engineers building our news recommendation engine. ' +
        'Core stack: Node.js, React, Next.js, MongoDB Atlas. ' +
        'Microservices architecture on GCP. 7+ years experience preferred.',
      jobUrl: 'https://smartnews.com/careers/lead-engineer',
      source: 'Sample Data',
    }),
    makeJob({
      title: 'Senior Node.js Developer',
      company: 'Rakuten',
      location: 'Tokyo, Japan',
      salary: '¥10,000,000 – ¥14,000,000 / year',
      description:
        'Join our global e-commerce platform team. ' +
        'Technologies: Node.js, Express, MongoDB, React. ' +
        'Experience with high-traffic distributed systems required.',
      jobUrl: 'https://global.rakuten.com/corp/careers/senior-nodejs-developer',
      source: 'Sample Data',
    }),
    makeJob({
      title: 'Backend Engineer (Node.js / Microservices)',
      company: 'Wantedly Inc.',
      location: 'Tokyo, Japan',
      salary: '¥9,000,000 – ¥12,000,000 / year',
      description:
        'Design and maintain our microservices-based social recruiting platform. ' +
        'Stack: Node.js, GraphQL, MongoDB, Next.js, Docker. ' +
        'Senior level (5+ years) expected.',
      jobUrl: 'https://www.wantedly.com/projects/backend-engineer',
      source: 'Sample Data',
    }),
    makeJob({
      title: 'Senior Full-Stack Developer – Node / React',
      company: 'N26 GmbH',
      location: 'Berlin, Germany',
      salary: '€85,000 – €110,000 / year',
      description:
        'Build the future of mobile banking. ' +
        'We use Node.js microservices, React, MongoDB, and AWS Lambda. ' +
        'Senior engineers with 5+ years experience welcome.',
      jobUrl: 'https://n26.com/en-eu/careers/senior-full-stack-developer',
      source: 'Sample Data',
    }),
    makeJob({
      title: 'Lead Engineer – Platform Team',
      company: 'Zalando SE',
      location: 'Berlin, Germany',
      salary: '€90,000 – €120,000 / year',
      description:
        'Lead platform engineering for one of Europe\'s largest e-commerce companies. ' +
        'Core tech: Node.js, React, Kubernetes, MongoDB. ' +
        'Strong microservices background required.',
      jobUrl: 'https://jobs.zalando.com/lead-engineer-platform',
      source: 'Sample Data',
    }),
  ];
}

// ─── Main export ──────────────────────────────────────────────────────────────

async function scrapeAllSources() {
  console.log('\n🔍 Starting job scraping across all sources...\n');

  const keywords = 'Node.js backend microservices senior';
  const allJobs = [];

  // Japan sources
  const indeedJP = await scrapeIndeedJapan(keywords);
  allJobs.push(...indeedJP);
  await sleep(REQUEST_DELAY_MS);

  const wantedly = await scrapeWantedly('Node.js senior');
  allJobs.push(...wantedly);
  await sleep(REQUEST_DELAY_MS);

  // Germany sources
  const indeedDE = await scrapeIndeedGermany(keywords);
  allJobs.push(...indeedDE);
  await sleep(REQUEST_DELAY_MS);

  const stepstone = await scrapeStepstone('Node.js Backend Senior');
  allJobs.push(...stepstone);

  // If no live results, use sample data so the whole pipeline can be tested
  if (allJobs.length === 0) {
    console.log(
      '\n  ⚠️  No live results returned (likely bot-detection on job sites).'
    );
    console.log(
      '     Injecting sample jobs so you can test the full pipeline.\n'
    );
    allJobs.push(...getSampleJobs());
  }

  console.log(`\n📋 Total raw jobs collected: ${allJobs.length}\n`);
  return allJobs;
}

module.exports = { scrapeAllSources, getSampleJobs };
