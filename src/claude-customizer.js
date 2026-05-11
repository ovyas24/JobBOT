/**
 * claude-customizer.js
 * Uses the Claude API to generate a personalised cover letter opener
 * for each filtered job.
 *
 * Requires ANTHROPIC_API_KEY in .env
 */

const Anthropic = require('@anthropic-ai/sdk');

// ─── Config ───────────────────────────────────────────────────────────────────

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

// Om's profile — edit this to personalise the output
const CANDIDATE_PROFILE = {
  name: 'Om',
  yearsExperience: 5,
  coreSkills: ['Node.js', 'MongoDB', 'React', 'Next.js', 'microservices', 'REST APIs', 'GraphQL', 'Docker', 'AWS'],
  highlights: [
    '5+ years building production microservices at scale',
    'Led teams of 4-6 engineers',
    'Reduced API latency by 40% through MongoDB query optimisation',
    'Migrated monolith to microservices serving 500k daily users',
  ],
};

// ─── Client (lazy init) ───────────────────────────────────────────────────────

let _client = null;

function getClient() {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        'ANTHROPIC_API_KEY is not set. Copy .env.example → .env and add your key.'
      );
    }
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildPrompt(job) {
  const techList = (job.matchedTech || []).join(', ') || 'Node.js, MongoDB';

  return `You are helping ${CANDIDATE_PROFILE.name}, a senior software engineer with ${CANDIDATE_PROFILE.yearsExperience}+ years of experience, write a personalised cover letter opening for a job application.

CANDIDATE BACKGROUND:
- Core skills: ${CANDIDATE_PROFILE.coreSkills.join(', ')}
- Key highlights: ${CANDIDATE_PROFILE.highlights.join(' | ')}

JOB DETAILS:
- Title: ${job.title}
- Company: ${job.company}
- Location: ${job.location}
- Description: ${job.description || 'Not provided'}
- Matched tech from description: ${techList}

TASK:
Write EXACTLY 2-3 sentences that:
1. Opens with a genuine hook mentioning the company name and role title
2. Explains why ${CANDIDATE_PROFILE.name}'s microservices background is a direct fit
3. References 1-2 specific technologies from the job description that match his experience

RULES:
- Sound human and enthusiastic, not robotic or generic
- Do NOT use phrases like "I am writing to apply" or "I am excited to announce"
- Keep it under 80 words total
- Write in first person
- Output ONLY the cover letter text — no labels, no preamble`;
}

// ─── Single job processor ─────────────────────────────────────────────────────

async function generateCoverLetterSnippet(job) {
  const client = getClient();

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 256,
    messages: [
      {
        role: 'user',
        content: buildPrompt(job),
      },
    ],
  });

  return message.content[0]?.text?.trim() || '';
}

// ─── Batch processor ─────────────────────────────────────────────────────────

async function addCoverLetters(jobs = []) {
  if (jobs.length === 0) return jobs;

  console.log(`\n✍️  Generating cover letters with Claude (${MODEL})...\n`);

  const DELAY_MS = parseInt(process.env.REQUEST_DELAY_MS || '1500', 10);
  const results = [];

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    console.log(`  [${i + 1}/${jobs.length}] ${job.title} @ ${job.company}`);

    try {
      const snippet = await generateCoverLetterSnippet(job);
      results.push({ ...job, coverLetter: snippet });
      console.log(`     ✅ Cover letter generated (${snippet.split(' ').length} words)`);
    } catch (err) {
      const errMsg = err.message || String(err);
      console.warn(`     ⚠️  Skipping — Claude API error: ${errMsg}`);
      results.push({ ...job, coverLetter: `[Error: ${errMsg}]` });
    }

    // Polite delay between API calls (except after the last one)
    if (i < jobs.length - 1) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }

  console.log(`\n✅ Cover letters done: ${results.filter((j) => !j.coverLetter.startsWith('[Error')).length}/${jobs.length} succeeded\n`);
  return results;
}

module.exports = { addCoverLetters, generateCoverLetterSnippet, CANDIDATE_PROFILE };
