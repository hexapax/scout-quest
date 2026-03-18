#!/usr/bin/env node
/**
 * Batch research BSA content via Perplexity API.
 * Saves results as markdown files in docs/scouting-knowledge/.
 * Usage: PERPLEXITY_API_KEY=... nvm exec 24 node scripts/knowledge/research-bsa-content.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KB_DIR = path.join(__dirname, '..', '..', 'docs', 'scouting-knowledge');
const API_KEY = process.env.PERPLEXITY_API_KEY;
const DELAY_MS = 3000;

if (!API_KEY) { console.error('PERPLEXITY_API_KEY required'); process.exit(1); }

async function askPerplexity(query) {
  const resp = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'sonar-pro',
      messages: [
        { role: 'system', content: 'You are a Scouting America (formerly BSA) expert. Provide accurate, current information. Use the current name "Scouting America" but note "formerly BSA" where helpful. Be specific about requirement numbers and exact text. Include citations where possible.' },
        { role: 'user', content: query }
      ],
    }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Perplexity API ${resp.status}: ${err}`);
  }
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}

function writeKB(subdir, filename, frontmatter, content) {
  const dir = path.join(KB_DIR, subdir);
  fs.mkdirSync(dir, { recursive: true });
  const fm = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n');
  fs.writeFileSync(
    path.join(dir, filename),
    `---\n${fm}\ncurrent_as_of: "2026-03-16"\n---\n\n${content}\n`
  );
  console.log(`  Wrote ${subdir}/${filename} (${content.length} chars)`);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('=== Researching BSA content via Perplexity ===\n');
  let count = 0;

  // --- Rank Requirements ---
  const ranks = [
    { name: 'Scout', file: 'scout.md', rank: 'scout' },
    { name: 'Tenderfoot', file: 'tenderfoot.md', rank: 'tenderfoot' },
    { name: 'Second Class', file: 'second-class.md', rank: 'second-class' },
    { name: 'First Class', file: 'first-class.md', rank: 'first-class' },
    { name: 'Star', file: 'star.md', rank: 'star' },
    { name: 'Life', file: 'life.md', rank: 'life' },
    { name: 'Eagle Scout', file: 'eagle.md', rank: 'eagle' },
  ];

  for (const r of ranks) {
    console.log(`Researching: ${r.name} rank...`);
    try {
      const content = await askPerplexity(
        `List all current Scouting America (formerly BSA) ${r.name} rank requirements for the Scouts BSA program (most recent version as of 2025-2026). Include the FULL TEXT of each requirement with requirement numbers (1a, 1b, 2a, etc.). Note any recent changes from previous versions. For each requirement, include a brief practical tip for completing it efficiently.`
      );
      writeKB('ranks', r.file, {
        category: 'rank_requirement', rank: r.rank,
        tags: ['rank', r.rank, 'scouts-bsa'],
        source: 'Scouting America official requirements (via Perplexity research)',
      }, content);
      count++;
    } catch (e) { console.error(`  ERROR: ${e.message}`); }
    await sleep(DELAY_MS);
  }

  // --- Eagle-Required Merit Badges (prioritized by troop need) ---
  const eagleMBs = [
    'Family Life', 'Citizenship in the Community', 'Emergency Preparedness',
    'First Aid', 'Personal Management', 'Citizenship in the Nation',
    'Citizenship in the World', 'Cooking', 'Swimming', 'Camping',
    'Communication', 'Personal Fitness', 'Environmental Science',
    'Citizenship in Society',
  ];

  for (const mb of eagleMBs) {
    const filename = mb.toLowerCase().replace(/\s+/g, '-') + '.md';
    console.log(`Researching: ${mb} MB...`);
    try {
      const content = await askPerplexity(
        `List all current Scouting America (formerly BSA) ${mb} merit badge requirements. Include the FULL TEXT of each requirement with numbers. Note if this is Eagle-required (and if its Eagle-required status has changed recently). Include practical tips for completing each requirement. Note any version differences scouts might encounter.`
      );
      writeKB('merit-badges', filename, {
        category: 'merit_badge', merit_badge: mb.toLowerCase().replace(/\s+/g, '-'),
        tags: ['merit-badge', 'eagle-required', mb.toLowerCase().replace(/\s+/g, '-')],
        source: 'Scouting America official requirements (via Perplexity research)',
      }, content);
      count++;
    } catch (e) { console.error(`  ERROR: ${e.message}`); }
    await sleep(DELAY_MS);
  }

  // --- Key Policies ---
  const policies = [
    {
      query: 'Summarize the key sections of the Scouting America Guide to Advancement (current edition). Focus on: how advancement works, the role of the Scoutmaster conference, Board of Review procedures and rules (what can and cannot be asked, who serves, how decisions are made), partial completion and carryover rules, time requirements between ranks, alternate requirements for disabilities, and appeal procedures. Include section numbers where possible.',
      file: 'guide-to-advancement.md',
      tags: ['policy', 'advancement', 'bor', 'scoutmaster-conference'],
    },
    {
      query: 'What are the current Scouting America youth protection policies? Note: the program formerly called "Youth Protection Training (YPT)" has been renamed. Cover: two-deep leadership rules, no one-on-one contact policy, communication guidelines (social media, texting), mandatory reporting obligations, adult leader certification requirements, and how to report concerns. Note all recent name changes.',
      file: 'youth-protection.md',
      tags: ['policy', 'youth-protection', 'mandatory-reporter', 'ypt'],
    },
    {
      query: 'What are the current Scouting America Board of Review procedures and guidelines? Include: who can serve on a BOR (and who cannot), what questions are appropriate vs inappropriate (e.g., can they ask a scout to recite things?), how advancement decisions are made, what happens if a scout fails, and appeal procedures. Reference the Guide to Advancement sections.',
      file: 'board-of-review.md',
      tags: ['policy', 'board-of-review', 'advancement'],
    },
    {
      query: 'What is the current Scouting America Eagle Scout service project process? Include: the project proposal and approval workflow, fundraising rules, workbook requirements, timeline expectations, who must approve at each stage (unit, district, council), final writeup requirements, and the Eagle Board of Review process. Include the Eagle application and reference letter requirements.',
      file: 'eagle-project.md',
      tags: ['policy', 'eagle', 'eagle-project', 'service-project'],
    },
    {
      query: 'What are the current Scouting America Eagle-required merit badges as of 2025-2026? List the complete requirement. Note the recent changes regarding Citizenship in Society and any DEI-related badge changes, including which version of the Eagle-required list applies to which scouts based on when they started. Include any choice groups (e.g., Emergency Preparedness OR Lifesaving).',
      file: 'eagle-required-merit-badges.md',
      tags: ['policy', 'eagle', 'merit-badge', 'eagle-required'],
    },
  ];

  for (const p of policies) {
    console.log(`Researching: ${p.file}...`);
    try {
      const content = await askPerplexity(p.query);
      writeKB('policies', p.file, {
        category: 'policy', tags: p.tags,
        source: 'Scouting America official publications (via Perplexity research)',
      }, content);
      count++;
    } catch (e) { console.error(`  ERROR: ${e.message}`); }
    await sleep(DELAY_MS);
  }

  // --- Procedures ---
  const procedures = [
    {
      query: 'What are the Scouting America age requirements and time-in-rank requirements for each Scouts BSA rank (Scout through Eagle)? Include minimum age to join, the 18th birthday deadline for Eagle, and how time-between-ranks works for Star, Life, and Eagle.',
      file: 'age-and-time-requirements.md',
      tags: ['procedure', 'age', 'time-in-rank'],
    },
    {
      query: 'How does the Scouting America merit badge application (blue card) process work? Include how to get a blue card, counselor assignment, what happens with partial completions, counselor changes, troop transfers, and the digital alternatives to paper blue cards in Scoutbook.',
      file: 'blue-card-process.md',
      tags: ['procedure', 'blue-card', 'merit-badge'],
    },
    {
      query: 'What are the Scouting America Safe Swim Defense, Safety Afloat, Trek Safely, and Climb On Safely requirements? Summarize each policy with the key rules leaders must follow for each activity type.',
      file: 'safety-policies.md',
      tags: ['procedure', 'safety', 'aquatics', 'hiking', 'climbing'],
    },
    {
      query: 'What approved leadership positions count for Star, Life, and Eagle rank requirements in Scouting America Scouts BSA? List ALL approved positions (troop and non-troop) and the minimum service time required. Note any recent changes to the approved list.',
      file: 'leadership-positions.md',
      tags: ['procedure', 'leadership', 'position-of-responsibility'],
    },
  ];

  for (const p of procedures) {
    console.log(`Researching: ${p.file}...`);
    try {
      const content = await askPerplexity(p.query);
      writeKB('procedures', p.file, {
        category: 'procedure', tags: p.tags,
        source: 'Scouting America official publications (via Perplexity research)',
      }, content);
      count++;
    } catch (e) { console.error(`  ERROR: ${e.message}`); }
    await sleep(DELAY_MS);
  }

  console.log(`\n=== Done: ${count} knowledge files created ===`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
