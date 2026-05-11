/**
 * filter.js
 * Filters raw job listings by:
 *   - Keywords presence (Node.js, backend, microservices)
 *   - Exclusion terms (freelance, contract, part-time, internship)
 *   - Seniority (Senior / Lead / Principal / Staff)
 *   - Location priority (Japan > Germany > India)
 *   - Tech stack match (Node.js, MongoDB, React / Next.js)
 */

// ─── Config ───────────────────────────────────────────────────────────────────

const REQUIRED_KEYWORDS = ['node', 'nodejs', 'node.js', 'backend', 'microservice', 'microservices'];

const SENIORITY_TERMS = ['senior', 'lead', 'principal', 'staff engineer', 'engineering manager'];

const TECH_STACK = ['node.js', 'nodejs', 'mongodb', 'mongo', 'react', 'next.js', 'nextjs'];

const EXCLUDE_TERMS = ['freelance', 'contract', 'part-time', 'parttime', 'intern', 'internship', 'trainee', 'apprentice'];

const LOCATION_PRIORITY = {
  japan: 1,
  tokyo: 1,
  osaka: 1,
  kyoto: 1,
  yokohama: 1,
  germany: 2,
  berlin: 2,
  munich: 2,
  hamburg: 2,
  frankfurt: 2,
  india: 3,
  bangalore: 3,
  bengaluru: 3,
  mumbai: 3,
  hyderabad: 3,
  delhi: 3,
  pune: 3,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalize(text = '') {
  return text.toLowerCase();
}

function containsAny(text, terms) {
  const n = normalize(text);
  return terms.some((t) => n.includes(normalize(t)));
}

function getLocationPriority(location = '') {
  const n = normalize(location);
  for (const [key, priority] of Object.entries(LOCATION_PRIORITY)) {
    if (n.includes(key)) return priority;
  }
  return 99; // unknown location gets lowest priority
}

function countTechMatches(job) {
  const haystack = normalize(`${job.title} ${job.description}`);
  return TECH_STACK.filter((t) => haystack.includes(normalize(t))).length;
}

function extractMatchedTech(job) {
  const haystack = normalize(`${job.title} ${job.description}`);
  return TECH_STACK.filter((t) => haystack.includes(normalize(t)));
}

// ─── Main filter ──────────────────────────────────────────────────────────────

function filterJobs(jobs = []) {
  console.log(`🔎 Filtering ${jobs.length} raw jobs...\n`);

  const filtered = jobs.filter((job) => {
    const combined = `${job.title} ${job.description} ${job.company}`;

    // Must contain at least one required keyword
    if (!containsAny(combined, REQUIRED_KEYWORDS)) {
      return false;
    }

    // Must look like a senior/lead position
    if (!containsAny(job.title, SENIORITY_TERMS)) {
      return false;
    }

    // Exclude unwanted employment types
    if (containsAny(combined, EXCLUDE_TERMS)) {
      return false;
    }

    // Must have at least one tech stack match.
    // Exception: if description is very short (detail page failed to load),
    // let the title keywords be enough — don't discard a "Senior Node.js Engineer" listing.
    const hasDescription = (job.description || '').length > 80;
    if (hasDescription && countTechMatches(job) === 0) {
      return false;
    }

    return true;
  });

  // Sort by: location priority → tech match count → alphabetical title
  filtered.sort((a, b) => {
    const locA = getLocationPriority(a.location);
    const locB = getLocationPriority(b.location);
    if (locA !== locB) return locA - locB;

    const techA = countTechMatches(a);
    const techB = countTechMatches(b);
    if (techA !== techB) return techB - techA;

    return a.title.localeCompare(b.title);
  });

  // Attach derived metadata useful later
  filtered.forEach((job) => {
    job.matchedTech = extractMatchedTech(job);
    job.locationPriority = getLocationPriority(job.location);
  });

  console.log(`✅ ${filtered.length} jobs matched your criteria\n`);

  if (filtered.length === 0) {
    console.log('  ℹ️  No matches after filtering. The sample jobs should always pass.');
    console.log('     Check REQUIRED_KEYWORDS / SENIORITY_TERMS in src/filter.js if needed.\n');
  }

  return filtered;
}

// ─── Summary printer ─────────────────────────────────────────────────────────

function printFilterSummary(jobs) {
  const byLocation = {};
  jobs.forEach((j) => {
    const region =
      j.locationPriority === 1 ? 'Japan' :
      j.locationPriority === 2 ? 'Germany' :
      j.locationPriority === 3 ? 'India' : 'Other';
    byLocation[region] = (byLocation[region] || 0) + 1;
  });

  console.log('📊 Matched jobs by region:');
  Object.entries(byLocation).forEach(([r, c]) => console.log(`   ${r}: ${c}`));
  console.log('');
}

module.exports = { filterJobs, printFilterSummary };
