/**
 * resume-pdf.js
 *
 * Converts the AI-tailored resume (Markdown) into an ATS-optimised PDF
 * using Playwright's built-in PDF export (no extra dependencies).
 *
 * ATS rules baked in:
 *   ✅ Single-column layout (no multi-column tables)
 *   ✅ Selectable text (not an image scan)
 *   ✅ Standard section names: Summary, Experience, Skills, Education
 *   ✅ Arial font — universally readable by ATS parsers
 *   ✅ No graphics, logos, or coloured boxes
 *   ✅ Black text on white — no colour gradients
 *   ✅ Clean heading hierarchy (h1 → name, h2 → sections)
 *   ✅ Contact info at the very top as plain text
 *   ✅ Proper bullet points (real <li> tags, not dashes or unicode)
 *   ✅ A4 format with generous margins
 */

const path = require('path');
const fs   = require('fs');

// ─── Candidate contact info (pulled from ai-agent CANDIDATE) ─────────────────

const { CANDIDATE } = require('./ai-agent');

// ─── Markdown → clean HTML ────────────────────────────────────────────────────
// Handles the exact format our AI produces: ##, **, -, plain paragraphs.

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inlineFormat(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>')
    .replace(/`(.+?)`/g,       '<code>$1</code>');
}

function markdownToHTML(md) {
  const lines  = (md || '').split('\n');
  const chunks = [];
  let inList   = false;

  const closeList = () => {
    if (inList) { chunks.push('</ul>'); inList = false; }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (/^# (.+)/.test(line)) {
      closeList();
      // Top-level heading → already shown as name in header; skip or use as section
      chunks.push(`<h1>${escapeHTML(line.replace(/^# /, ''))}</h1>`);

    } else if (/^## (.+)/.test(line)) {
      closeList();
      chunks.push(`<h2>${escapeHTML(line.replace(/^## /, ''))}</h2>`);

    } else if (/^### (.+)/.test(line)) {
      closeList();
      chunks.push(`<h3>${inlineFormat(escapeHTML(line.replace(/^### /, '')))}</h3>`);

    } else if (/^[-*] (.+)/.test(line)) {
      if (!inList) { chunks.push('<ul>'); inList = true; }
      chunks.push(`<li>${inlineFormat(escapeHTML(line.replace(/^[-*] /, '')))}</li>`);

    } else if (line.trim() === '') {
      closeList();
      // blank line = paragraph break (don't add <br> spam)

    } else {
      closeList();
      chunks.push(`<p>${inlineFormat(escapeHTML(line.trim()))}</p>`);
    }
  }

  closeList();
  return chunks.join('\n');
}

// ─── Full HTML document ───────────────────────────────────────────────────────

function buildATSDocument(markdownContent, job) {
  const bodyHTML = markdownToHTML(markdownContent);
  const contactParts = [
    CANDIDATE.email,
    CANDIDATE.linkedIn,
    job.location || '',
  ].filter(Boolean).join('  |  ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${escapeHTML(CANDIDATE.name)} — ${escapeHTML(job.title || 'Resume')}</title>
  <style>
    /* ── Reset ── */
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

    /* ── Page ── */
    html, body {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 10.5pt;
      line-height: 1.45;
      color: #000;
      background: #fff;
    }

    /* ── Print page setup ── */
    @page {
      size: A4;
      margin: 14mm 16mm 14mm 16mm;
    }

    /* ── Name block ── */
    .resume-header {
      text-align: center;
      margin-bottom: 10px;
      padding-bottom: 8px;
      border-bottom: 1.5px solid #000;
    }
    .resume-header h1 {
      font-size: 18pt;
      font-weight: bold;
      letter-spacing: 0.5px;
      border: none;
      text-transform: none;
      margin: 0 0 4px 0;
      padding: 0;
    }
    .resume-header .contact {
      font-size: 9.5pt;
      color: #222;
    }
    .resume-header .target-role {
      font-size: 10.5pt;
      font-style: italic;
      color: #333;
      margin-top: 2px;
    }

    /* ── Section headings ── */
    h2 {
      font-size: 10.5pt;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      border-bottom: 1px solid #000;
      padding-bottom: 1px;
      margin: 12px 0 5px 0;
    }

    /* ── Job title rows ── */
    h3 {
      font-size: 10.5pt;
      font-weight: bold;
      margin: 7px 0 1px 0;
    }

    /* ── Body text ── */
    p {
      margin-bottom: 4px;
    }

    /* ── Bullet lists — real <ul> for ATS ── */
    ul {
      margin: 3px 0 5px 18px;
      padding: 0;
      list-style-type: disc;
    }
    li {
      margin-bottom: 2px;
    }

    /* ── Inline styles ── */
    strong { font-weight: bold; }
    em     { font-style: italic; }
    code   { font-family: Arial, sans-serif; } /* keep ATS-readable */

    /* ── Hide the h1 inside body (name already in header) ── */
    body > h1:first-of-type { display: none; }

    /* ── Page break control ── */
    h2 { page-break-after: avoid; }
    h3 { page-break-after: avoid; }
    ul  { page-break-inside: avoid; }
  </style>
</head>
<body>

  <!-- ATS-friendly header: name + contact as plain text, not image -->
  <div class="resume-header">
    <h1>${escapeHTML(CANDIDATE.name)}</h1>
    <div class="target-role">${escapeHTML(job.titleFit || job.title || CANDIDATE.currentTitle)}</div>
    <div class="contact">${escapeHTML(contactParts)}</div>
  </div>

  <!-- Body: AI-generated tailored resume in clean HTML -->
  ${bodyHTML}

</body>
</html>`;
}

// ─── PDF generator ────────────────────────────────────────────────────────────

async function generateResumePDF(markdownContent, outputPath, job = {}) {
  let playwright;
  try {
    playwright = require('playwright');
  } catch {
    throw new Error(
      'Playwright not installed.\n  Run: npm install playwright && npx playwright install chromium'
    );
  }

  const html    = buildATSDocument(markdownContent, job);
  const browser = await playwright.chromium.launch({ headless: true });
  const page    = await browser.newPage();

  await page.setContent(html, { waitUntil: 'domcontentloaded' });

  await page.pdf({
    path:            outputPath,
    format:          'A4',
    printBackground: false,           // white background — no colour printing
    margin:          { top: '14mm', right: '16mm', bottom: '14mm', left: '16mm' },
    displayHeaderFooter: false,       // no page numbers in header/footer
  });

  await browser.close();
}

// ─── Batch helper ─────────────────────────────────────────────────────────────

async function generateAllPDFs(jobs, resumeDir) {
  if (!fs.existsSync(resumeDir)) fs.mkdirSync(resumeDir, { recursive: true });

  console.log(`\n🖨️  Generating ATS-optimised PDFs for ${jobs.length} job(s)...\n`);

  let success = 0;
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    if (!job.tailoredResume) continue;

    const slug = `${job.company || 'unknown'}_${job.title || 'role'}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 55);

    const safeName = CANDIDATE.name.replace(/\s+/g, '_');
    const fileName = `${safeName}_Resume_${slug}.pdf`;
    const outPath  = path.join(resumeDir, fileName);

    process.stdout.write(`  [${i + 1}/${jobs.length}] ${job.title} @ ${job.company} ... `);

    try {
      await generateResumePDF(job.tailoredResume, outPath, job);
      success++;
      console.log(`✅  ${fileName}`);
    } catch (err) {
      console.log(`❌  ${err.message}`);
    }
  }

  console.log(`\n📁 PDFs saved → results/resumes/  (${success} files)\n`);
  return success;
}

module.exports = { generateResumePDF, generateAllPDFs };
