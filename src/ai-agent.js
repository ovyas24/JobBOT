/**
 * ai-agent.js
 *
 * Two-stage AI pipeline — replaces both filter.js and claude-customizer.js:
 *
 *   Stage 1 — Smart Filter
 *     Sends batches of raw jobs to the AI with Om's profile.
 *     AI scores each job 1–10 and returns only relevant ones (score >= threshold).
 *     No hardcoded keywords, seniority rules, or tech-stack lists.
 *
 *   Stage 2 — Application Package
 *     For each matched job, AI generates a complete application package:
 *       · Full cover letter (3 paragraphs)
 *       · Email subject line
 *       · Key talking points (for interviews)
 *       · Why this company / role fits
 *       · Answers to common application form questions
 *       · Questions Om should ask them
 *
 * Supports: Anthropic Claude | OpenAI | Ollama (free local)
 * Set AI_PROVIDER in .env
 */

// ─── Om's profile ─────────────────────────────────────────────────────────────
// Edit this to reflect your current resume and preferences.

const CANDIDATE = {
  name:          'Om Prakash Vyas',
  currentTitle:  'Lead Software Engineer',
  currentCompany:'Instavans (logistics tech)',
  yearsTotal:    5,
  skills:        ['Node.js', 'MongoDB', 'Next.js', 'React', 'REST APIs', 'GraphQL',
                  'Microservices', 'Docker', 'AWS', 'Python', 'SQL'],
  highlights: [
    'Lead Software Engineer at Instavans for 5 years — grew from intern to lead',
    'Built real-time vehicle tracking system serving live logistics operations',
    'Designed routing optimisation algorithm for last-mile delivery',
    'Integrated ML models for demand forecasting and dynamic pricing',
    'Built chatbot middleware APIs at Trilyo (Node.js, connecting chat to client backends)',
    'Freelance full-stack web developer for 1+ years',
  ],
  preferredLocations: ['Japan', 'Tokyo', 'Germany', 'Berlin', 'Remote'],
  preferredRoles:     ['Senior', 'Lead', 'Staff', 'Principal', 'Backend', 'Full-Stack'],
  minSalary:          { JPY: 8_000_000, EUR: 70_000, USD: 70_000 },
  linkedIn:           'https://www.linkedin.com/in/om-prakash-vyas-68b9a2160',
  email:              'ovyas24@gmail.com',
};

// ─── Provider config ──────────────────────────────────────────────────────────

const PROVIDER = (process.env.AI_PROVIDER || 'ollama').toLowerCase();
const MODELS   = {
  anthropic: process.env.CLAUDE_MODEL  || 'claude-haiku-4-5-20251001',
  openai:    process.env.OPENAI_MODEL  || 'gpt-4o-mini',
  ollama:    process.env.OLLAMA_MODEL  || 'llama3',
};
const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const FILTER_THRESHOLD = parseInt(process.env.AI_FILTER_THRESHOLD || '6', 10);
const BATCH_SIZE       = parseInt(process.env.AI_BATCH_SIZE       || '5', 10);

// ─── AI caller ───────────────────────────────────────────────────────────────

async function callAI(prompt, maxTokens = 1024) {
  if (PROVIDER === 'anthropic') {
    const Anthropic = require('@anthropic-ai/sdk');
    const client    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg       = await client.messages.create({
      model: MODELS.anthropic, max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });
    return msg.content[0]?.text?.trim() || '';
  }

  if (PROVIDER === 'openai') {
    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const res    = await client.chat.completions.create({
      model: MODELS.openai, max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });
    return res.choices[0]?.message?.content?.trim() || '';
  }

  // Ollama (default — free, local)
  const fetch = require('node-fetch');
  const res   = await fetch(`${OLLAMA_BASE}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:  MODELS.ollama,
      prompt,
      stream: false,
      options: { num_predict: maxTokens, temperature: 0.3 },
    }),
    timeout: 120000,
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  return ((await res.json()).response || '').trim();
}

/** Parse JSON from AI response, stripping markdown fences if present */
function parseJSON(text) {
  const clean = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  // Find first [ or { to handle preamble text
  const start = Math.min(
    clean.indexOf('[') === -1 ? Infinity : clean.indexOf('['),
    clean.indexOf('{') === -1 ? Infinity : clean.indexOf('{'),
  );
  return JSON.parse(clean.slice(start));
}

// ─── Stage 1: Smart Filter ────────────────────────────────────────────────────

const FILTER_PROMPT = (jobs) => `
You are a job-matching assistant. Evaluate each job listing for ${CANDIDATE.name}.

CANDIDATE PROFILE:
- Current: ${CANDIDATE.currentTitle} at ${CANDIDATE.currentCompany}
- ${CANDIDATE.yearsTotal}+ years experience
- Skills: ${CANDIDATE.skills.join(', ')}
- Highlights: ${CANDIDATE.highlights.join(' | ')}
- Preferred locations: ${CANDIDATE.preferredLocations.join(', ')}
- Preferred roles: ${CANDIDATE.preferredRoles.join(', ')}

JOBS TO EVALUATE (JSON array):
${JSON.stringify(jobs.map((j, i) => ({
  id: i,
  title: j.title,
  company: j.company,
  location: j.location,
  salary: j.salary,
  description: (j.description || j.rawText || '').slice(0, 600),
})), null, 2)}

For each job, return a JSON array with this exact shape:
[
  {
    "id": 0,
    "score": 8,
    "reason": "one sentence why this is or isn't a good fit",
    "matchedSkills": ["Node.js", "MongoDB"],
    "titleFit": "Senior Backend Engineer"
  }
]

Scoring guide:
9-10 = Near-perfect match (right level, right tech, right location)
7-8  = Good match with minor gaps
5-6  = Partial match, worth considering
1-4  = Poor fit (wrong tech, wrong seniority, wrong location)

Return ONLY valid JSON. No explanations outside the JSON.`.trim();

async function filterJobsWithAI(jobs) {
  if (jobs.length === 0) return [];

  console.log(`\n🤖 AI Filter [${PROVIDER}/${MODELS[PROVIDER]}] — evaluating ${jobs.length} jobs in batches of ${BATCH_SIZE}...\n`);

  const scored  = [];
  const batches = [];
  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    batches.push(jobs.slice(i, i + BATCH_SIZE));
  }

  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];
    console.log(`  Batch ${bi + 1}/${batches.length} (${batch.length} jobs)...`);

    try {
      const raw    = await callAI(FILTER_PROMPT(batch), 800);
      const parsed = parseJSON(raw);

      parsed.forEach(result => {
        const job = batch[result.id];
        if (!job) return;
        scored.push({
          ...job,
          aiScore:       result.score || 0,
          aiReason:      result.reason || '',
          matchedSkills: result.matchedSkills || [],
          titleFit:      result.titleFit || job.title,
        });
      });
    } catch (err) {
      console.warn(`  ⚠️  Batch ${bi + 1} parse error: ${err.message} — passing all through`);
      // If AI fails, pass all jobs through unscored rather than dropping them
      batch.forEach(job => scored.push({ ...job, aiScore: 5, aiReason: 'AI parse error', matchedSkills: [] }));
    }

    await new Promise(r => setTimeout(r, 500));
  }

  const matched = scored
    .filter(j => j.aiScore >= FILTER_THRESHOLD)
    .sort((a, b) => b.aiScore - a.aiScore);

  console.log(`\n✅ AI Filter: ${matched.length}/${jobs.length} jobs scored >= ${FILTER_THRESHOLD}\n`);

  // Print score table
  scored.sort((a, b) => b.aiScore - a.aiScore).forEach(j => {
    const icon = j.aiScore >= FILTER_THRESHOLD ? '✅' : '❌';
    console.log(`  ${icon} [${j.aiScore}/10] ${j.title} @ ${j.company || '?'} — ${j.aiReason}`);
  });
  console.log('');

  return matched;
}

// ─── Stage 2: Application Package ────────────────────────────────────────────

const PACKAGE_PROMPT = (job) => `
You are helping ${CANDIDATE.name} apply for a job. Generate a complete application package.

CANDIDATE:
- ${CANDIDATE.currentTitle} at ${CANDIDATE.currentCompany}, ${CANDIDATE.yearsTotal}+ years
- Skills: ${CANDIDATE.skills.join(', ')}
- Highlights: ${CANDIDATE.highlights.join(' | ')}
- LinkedIn: ${CANDIDATE.linkedIn}

JOB:
- Title: ${job.title}
- Company: ${job.company}
- Location: ${job.location}
- Salary: ${job.salary}
- Matched skills: ${(job.matchedSkills || []).join(', ')}
- Description: ${(job.description || job.rawText || '').slice(0, 800)}

Generate a JSON object with exactly these fields:
{
  "coverLetter": "Full 3-paragraph cover letter in first person. Para 1: hook mentioning company+role. Para 2: specific experience match. Para 3: why this company + call to action.",
  "emailSubject": "Subject line if applying via email (under 60 chars)",
  "talkingPoints": ["3-5 bullet points to emphasise in interview"],
  "whyThisCompany": "2 sentences on why Om specifically wants this company",
  "formAnswers": {
    "whyApplying": "answer to 'why are you applying' form field",
    "greatestStrength": "answer to 'greatest strength' field",
    "salaryExpectation": "polite salary answer"
  },
  "questionsToAsk": ["2-3 smart questions Om should ask the interviewer"]
}

Return ONLY valid JSON. Write as Om, first person.`.trim();

async function prepareApplications(jobs) {
  if (jobs.length === 0) return [];
  console.log(`\n📝 Preparing application packages for ${jobs.length} matched job(s)...\n`);

  const result = [];
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    console.log(`  [${i + 1}/${jobs.length}] ${job.title} @ ${job.company}`);
    try {
      const raw = await callAI(PACKAGE_PROMPT(job), 1500);
      const pkg = parseJSON(raw);
      result.push({ ...job, applicationPackage: pkg });
      console.log(`     ✅ Package ready (cover letter: ${pkg.coverLetter?.split(' ').length || 0} words)`);
    } catch (err) {
      console.warn(`     ⚠️  Could not generate package: ${err.message}`);
      result.push({ ...job, applicationPackage: null });
    }
    await new Promise(r => setTimeout(r, 800));
  }
  return result;
}

// ─── Stage 3: Resume Tailoring ────────────────────────────────────────────────

const RESUME_PROMPT = (job, resumeText) => `
You are a professional resume writer. Tailor ${CANDIDATE.name}'s resume specifically for this job.

TARGET JOB:
- Title: ${job.title}
- Company: ${job.company}
- Location: ${job.location}
- AI Match Score: ${job.aiScore}/10
- Matched Skills: ${(job.matchedSkills || []).join(', ')}
- Description: ${(job.description || job.rawText || '').slice(0, 800)}

ORIGINAL RESUME:
${resumeText}

TASK: Produce a tailored version of this resume optimised for the target job above.

Rules:
1. Rewrite the SUMMARY to directly reference this company/role (mention company name, key requirement)
2. Reorder the SKILLS section — put the skills most relevant to this job first
3. Add 1-2 tailored bullet points under the most relevant experience (do not fabricate — rephrase existing achievements using the job's language)
4. Keep all dates, companies, education exactly as-is
5. Add a "WHY ${(job.company || 'THIS COMPANY').toUpperCase()}" section (2 sentences) at the top after the summary
6. Output clean Markdown — use ## for sections, **bold** for job titles

Return ONLY the tailored resume in Markdown. No commentary outside the resume.`.trim();

async function tailorResume(jobs, resumeText) {
  if (!resumeText || jobs.length === 0) return jobs;

  console.log(`\n📄 Tailoring resume for ${jobs.length} matched job(s)...\n`);

  const result = [];
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    console.log(`  [${i + 1}/${jobs.length}] ${job.title} @ ${job.company}`);
    try {
      const tailored = await callAI(RESUME_PROMPT(job, resumeText), 2000);
      result.push({ ...job, tailoredResume: tailored });
      const wordCount = tailored.split(/\s+/).length;
      console.log(`     ✅ Tailored resume ready (${wordCount} words)`);
    } catch (err) {
      console.warn(`     ⚠️  Resume tailoring failed: ${err.message}`);
      result.push({ ...job, tailoredResume: null });
    }
    await new Promise(r => setTimeout(r, 600));
  }
  return result;
}

module.exports = { filterJobsWithAI, prepareApplications, tailorResume, CANDIDATE, PROVIDER };
