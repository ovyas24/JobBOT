/**
 * claude-customizer.js
 * Generates personalised cover letter snippets for each matched job.
 *
 * Supports three AI providers — set AI_PROVIDER in .env:
 *   anthropic  (default) — needs ANTHROPIC_API_KEY from console.anthropic.com
 *   openai               — needs OPENAI_API_KEY from platform.openai.com
 *   ollama               — FREE, runs locally, needs Ollama installed (ollama.com)
 *
 * NOTE: Claude.ai Pro ($20/mo) is the chat interface only.
 *       API access is billed separately at console.anthropic.com.
 *       New API accounts get $5 free credits.
 */

// ─── Config ───────────────────────────────────────────────────────────────────

const PROVIDER = (process.env.AI_PROVIDER || 'anthropic').toLowerCase();

// Models per provider
const MODELS = {
  anthropic: process.env.CLAUDE_MODEL    || 'claude-haiku-4-5-20251001', // cheapest Claude
  openai:    process.env.OPENAI_MODEL    || 'gpt-4o-mini',               // cheapest GPT-4 class
  ollama:    process.env.OLLAMA_MODEL    || 'llama3',                    // free local model
};

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';

// ─── Om's profile (sourced from resume) ──────────────────────────────────────

const CANDIDATE_PROFILE = {
  name: 'Om Prakash Vyas',
  currentTitle: 'Lead Software Engineer',
  currentCompany: 'Instavans',
  yearsExperience: 5,
  coreSkills: [
    'Node.js', 'MongoDB', 'Next.js', 'React',
    'REST APIs', 'Middleware APIs', 'Chatbot integrations',
    'Real-time systems', 'Routing algorithms', 'Machine Learning (demand forecasting)',
  ],
  highlights: [
    'Lead Software Engineer at Instavans (logistics tech) for 5+ years — grew from intern to lead',
    'Built real-time vehicle tracking web app handling live logistics data',
    'Optimised routing algorithm for efficient last-mile delivery',
    'Integrated ML models for demand forecasting and dynamic pricing',
    'Developed middleware APIs at Trilyo connecting chat services to client backends',
    'Built REST APIs for web services at LogicsBar',
    'BCA in Computer Programming — Maharshi Dayanand University',
    'Certifications: VMware Software Defined Storage, Python (Kaggle/HackerRank), ML',
  ],
  linkedin: 'https://www.linkedin.com/in/om-prakash-vyas-68b9a2160',
};

// ─── Provider clients (lazy init) ────────────────────────────────────────────

let _anthropicClient = null;
let _openaiClient    = null;

function getAnthropicClient() {
  if (!_anthropicClient) {
    if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'your_anthropic_api_key_here') {
      throw new Error(
        'ANTHROPIC_API_KEY missing.\n' +
        '  • Get a key (with $5 free credits) at https://console.anthropic.com\n' +
        '  • Note: Claude.ai Pro is chat-only — API billing is separate.'
      );
    }
    const Anthropic = require('@anthropic-ai/sdk');
    _anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropicClient;
}

function getOpenAIClient() {
  if (!_openaiClient) {
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your_openai_api_key_here') {
      throw new Error('OPENAI_API_KEY missing. Get one at https://platform.openai.com/api-keys');
    }
    const OpenAI = require('openai');
    _openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openaiClient;
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

function buildPrompt(job) {
  const techList = (job.matchedTech || []).join(', ') || 'Node.js, MongoDB';
  const p = CANDIDATE_PROFILE;

  return `You are helping ${p.name}, a ${p.currentTitle} at ${p.currentCompany} with ${p.yearsExperience}+ years of experience, write a personalised cover letter opening.

CANDIDATE BACKGROUND:
- Current role: ${p.currentTitle} @ ${p.currentCompany} (logistics tech startup)
- Core skills: ${p.coreSkills.join(', ')}
- Key highlights: ${p.highlights.join(' | ')}

JOB DETAILS:
- Title: ${job.title}
- Company: ${job.company}
- Location: ${job.location}
- Description: ${job.description || 'Not provided'}
- Matched tech from description: ${techList}

TASK:
Write EXACTLY 2-3 sentences that:
1. Opens with a genuine hook mentioning the company name and role title
2. Connects ${p.name}'s logistics-scale Node.js / API experience as a direct fit
3. References 1-2 specific technologies from the job description that match his background

RULES:
- Sound human and confident, not robotic or generic
- Do NOT use "I am writing to apply" or "I am excited to announce"
- Keep it under 80 words total
- Write in first person as Om
- Output ONLY the cover letter text — no labels, no preamble`;
}

// ─── Generate via Anthropic ───────────────────────────────────────────────────

async function generateWithAnthropic(job) {
  const client = getAnthropicClient();
  const message = await client.messages.create({
    model: MODELS.anthropic,
    max_tokens: 256,
    messages: [{ role: 'user', content: buildPrompt(job) }],
  });
  return message.content[0]?.text?.trim() || '';
}

// ─── Generate via OpenAI ──────────────────────────────────────────────────────

async function generateWithOpenAI(job) {
  const client = getOpenAIClient();
  const response = await client.chat.completions.create({
    model: MODELS.openai,
    max_tokens: 256,
    messages: [{ role: 'user', content: buildPrompt(job) }],
  });
  return response.choices[0]?.message?.content?.trim() || '';
}

// ─── Generate via Ollama (free, local) ───────────────────────────────────────

async function generateWithOllama(job) {
  const fetch = require('node-fetch');
  const url = `${OLLAMA_BASE_URL}/api/generate`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODELS.ollama,
      prompt: buildPrompt(job),
      stream: false,
      options: { num_predict: 256, temperature: 0.7 },
    }),
    timeout: 60000,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ollama error ${response.status}: ${text}`);
  }

  const data = await response.json();
  return (data.response || '').trim();
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

async function generateCoverLetterSnippet(job) {
  switch (PROVIDER) {
    case 'openai':  return generateWithOpenAI(job);
    case 'ollama':  return generateWithOllama(job);
    default:        return generateWithAnthropic(job);
  }
}

// ─── Batch processor ─────────────────────────────────────────────────────────

async function addCoverLetters(jobs = []) {
  if (jobs.length === 0) return jobs;

  const modelLabel = `${PROVIDER} / ${MODELS[PROVIDER]}`;
  console.log(`\n✍️  Generating cover letters  [${modelLabel}]...\n`);

  const DELAY_MS = parseInt(process.env.REQUEST_DELAY_MS || '1500', 10);
  const results  = [];

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    console.log(`  [${i + 1}/${jobs.length}] ${job.title} @ ${job.company}`);

    try {
      const snippet = await generateCoverLetterSnippet(job);
      results.push({ ...job, coverLetter: snippet });
      console.log(`     ✅ ${snippet.split(' ').length} words`);
    } catch (err) {
      const msg = err.message || String(err);
      console.warn(`     ⚠️  Skipped — ${msg}`);
      results.push({ ...job, coverLetter: `[Error: ${msg}]` });
    }

    if (i < jobs.length - 1) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }

  const ok = results.filter((j) => !j.coverLetter.startsWith('[Error')).length;
  console.log(`\n✅ Cover letters: ${ok}/${jobs.length} succeeded\n`);
  return results;
}

module.exports = { addCoverLetters, generateCoverLetterSnippet, CANDIDATE_PROFILE, PROVIDER, MODELS };
