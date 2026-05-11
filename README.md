# job-hunter-japan 🤖

Automated job hunting bot for senior Node.js / microservices roles in **Japan**, **Germany**, and **India**.

- Scrapes **Indeed Japan**, **Indeed Germany**, **Wantedly**, and **Stepstone**
- Filters by seniority (Senior / Lead), tech stack (Node.js, MongoDB, React/Next.js), and keywords
- Uses **Claude AI** to write a personalised 2-3 sentence cover letter opener for every matched job
- Exports results to **CSV** and **JSON** in the `results/` folder

---

## Quick Start

```bash
# 1. Clone and enter the project
git clone <your-repo-url>
cd job-hunter-japan

# 2. Install dependencies
npm install

# 3. Set up your API key
cp .env.example .env
# Open .env and replace "your_anthropic_api_key_here" with your real key
# Get one free at https://console.anthropic.com

# 4. Run the bot
npm start
```

Or use the convenience script (handles everything automatically):

```bash
chmod +x run.sh
./run.sh
```

---

## Output

Results are saved to `results/` with a timestamp:

```
results/
  jobs_2025-05-11T09-30-00.csv
  jobs_2025-05-11T09-30-00.json
```

### CSV columns

| Column | Description |
|---|---|
| `JobTitle` | Role title |
| `Company` | Hiring company |
| `Location` | City / country |
| `Salary` | Salary range (if listed) |
| `JobURL` | Direct link to the posting |
| `Source` | Which site it came from |
| `MatchedTech` | Stack terms found in the description |
| `CustomizedCoverLetter` | AI-generated opener |
| `DateFound` | Date the bot ran |

---

## Configuration

All settings live in `.env`:

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | *(required)* | Your Claude API key |
| `MAX_JOBS_PER_SOURCE` | `20` | Max jobs scraped per site |
| `REQUEST_DELAY_MS` | `1500` | Delay between requests (ms) |
| `CLAUDE_MODEL` | `claude-sonnet-4-6` | Claude model to use |
| `OUTPUT_DIR` | `results` | Where to save exports |

### Tweaking filters

Edit `src/filter.js` to change:
- **REQUIRED_KEYWORDS** — what must appear in the job text
- **SENIORITY_TERMS** — which title keywords count as "senior enough"
- **TECH_STACK** — tech to match against descriptions
- **EXCLUDE_TERMS** — employment types to skip
- **LOCATION_PRIORITY** — region ranking (lower number = higher priority)

### Updating your profile

Edit the `CANDIDATE_PROFILE` object in `src/claude-customizer.js`:

```js
const CANDIDATE_PROFILE = {
  name: 'Om',
  yearsExperience: 5,
  coreSkills: ['Node.js', 'MongoDB', 'React', ...],
  highlights: [
    '5+ years building production microservices at scale',
    ...
  ],
};
```

---

## Running on a Schedule (Cron)

To run the bot every morning at 8 AM automatically:

```bash
# Open crontab
crontab -e

# Add this line (update the path to match your setup)
0 8 * * * cd /path/to/job-hunter-japan && npm start >> logs/cron.log 2>&1
```

For a more visible daily reminder, use:

```bash
# Run at 8 AM Mon–Fri only
0 8 * * 1-5 cd /path/to/job-hunter-japan && ./run.sh >> logs/cron.log 2>&1
```

Make the logs directory first:

```bash
mkdir -p logs
```

---

## Project Structure

```
job-hunter-japan/
├── src/
│   ├── scraper.js          # Indeed JP/DE, Wantedly, Stepstone scrapers
│   ├── filter.js           # Keyword, seniority & tech-stack filtering
│   ├── claude-customizer.js # Claude API – cover letter generation
│   └── index.js            # Main entry point & CSV/JSON export
├── results/                # Generated output (git-ignored)
├── .env.example            # API key template
├── .gitignore
├── package.json
├── run.sh                  # One-click launcher
└── README.md
```

---

## Scraper Notes

Public job sites frequently change their HTML structure and may block automated
requests with CAPTCHAs or JS challenges. If a scraper returns 0 results, the bot
automatically injects realistic **sample jobs** so you can test the full pipeline
(filtering + Claude cover letters + CSV export) without live data.

For production-grade reliability consider:
- [Indeed Publisher API](https://publisher.indeed.com/apis) — official, structured
- A headless browser (Playwright/Puppeteer) to handle JS-rendered pages
- Rotating proxies / residential IPs for high-volume scraping

---

## License

MIT
