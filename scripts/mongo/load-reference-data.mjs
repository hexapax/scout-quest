#!/usr/bin/env node
/**
 * Load rank requirement text + MB definitions into scoutbook_reference collection.
 * Generates a mongosh script since we can't connect directly to production MongoDB.
 * Usage: nvm exec 24 node scripts/mongo/load-reference-data.mjs > /tmp/reference-import.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRESH = path.join(__dirname, '..', '..', 'scouting-org-research', 'data', 'fresh');

const RANK_NAMES = {
  1: 'Scout', 2: 'Tenderfoot', 3: 'Second Class',
  4: 'First Class', 5: 'Star', 6: 'Life', 7: 'Eagle'
};

const lines = [];
function emit(line) { lines.push(line); }

emit('// Auto-generated: load BSA reference data into scoutbook_reference');
emit('db.scoutbook_reference.createIndex({ type: 1, rankId: 1, reqNumber: 1, version: 1 }, { unique: true, partialFilterExpression: { type: "rank_requirement" } });');
emit('db.scoutbook_reference.createIndex({ type: 1, meritBadgeId: 1 }, { unique: true, partialFilterExpression: { type: "merit_badge" } });');

let count = 0;

// Rank requirements
for (const [rankIdStr, rankName] of Object.entries(RANK_NAMES)) {
  const rankId = parseInt(rankIdStr);
  const fn = path.join(FRESH, `ref_rank_${rankId}_requirements.json`);
  if (!fs.existsSync(fn)) continue;

  const data = JSON.parse(fs.readFileSync(fn, 'utf-8'));
  const reqs = Array.isArray(data) ? data : (data.requirements || []);

  for (const req of reqs) {
    const doc = {
      type: 'rank_requirement',
      rankId,
      rankName,
      reqNumber: req.requirementNumber || req.listNumber || '',
      fullText: (req.name || '').replace(/"/g, '\\"'),
      short: (req.short || '').replace(/"/g, '\\"'),
      version: req.versionId || 'current',
      sortOrder: req.sortOrder || '',
      required: req.required === 'True',
      parentReqId: req.parentRequirementId || null,
    };
    emit(`db.scoutbook_reference.updateOne({type:"rank_requirement",rankId:${rankId},reqNumber:"${doc.reqNumber}",version:"${doc.version}"},{$set:${JSON.stringify(doc)}},{upsert:true});`);
    count++;
  }
}

// Merit badge definitions
const mbFn = path.join(FRESH, 'ref_meritBadges.json');
const mbData = JSON.parse(fs.readFileSync(mbFn, 'utf-8'));
const badges = Array.isArray(mbData) ? mbData : (mbData.meritBadges || mbData);

for (const mb of badges) {
  const doc = {
    type: 'merit_badge',
    meritBadgeId: mb.id,
    name: mb.name,
    short: mb.short || mb.name,
    description: (mb.description || '').replace(/"/g, '\\"'),
    isEagleRequired: mb.isEagleRequired || false,
    categoryName: mb.meritBadgeCategoryName || '',
    version: mb.version || mb.versionId || 'current',
    imageUrl: mb.imageUrl200 || mb.imageUrl100 || '',
    worksheetPDF: mb.worksheetPDF || '',
    bsaRequirements: mb.bsaRequirements || '',
  };
  emit(`db.scoutbook_reference.updateOne({type:"merit_badge",meritBadgeId:${mb.id}},{$set:${JSON.stringify(doc)}},{upsert:true});`);
  count++;
}

emit(`print("Loaded ${count} reference documents");`);
emit(`print("  Rank requirements: ${count - badges.length}");`);
emit(`print("  Merit badge definitions: ${badges.length}");`);
emit(`print("  Total: " + db.scoutbook_reference.countDocuments());`);

process.stdout.write(lines.join('\n'));
process.stderr.write(`\nGenerated ${count} upserts\n`);
