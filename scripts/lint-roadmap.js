#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const VALID_ROADMAP_TAGS = ['shipped', 'in flight', 'pending', 'blocked', 'deferred', 'withdrawn'];
const COMPLETE_BANNER_RE = /Status:\s*COMPLETE\s*[·-]\s*(MONITORING|MAINTENANCE)/i;
const NON_CORE_MARKER = ' · non-core';
const VALID_TAG_RE = '(shipped|in flight|pending|blocked|deferred|withdrawn)';
const ITEM_RE = new RegExp(`^\\s*-\\s+.+\\s\\[${VALID_TAG_RE}\\](\\s·\\sowner-gated)?\\s*$`);
const ANY_TAG_RE = /\[[^\]]+\](\s·\sowner-gated)?\s*$/;
const META_SECTIONS = new Set(['status taxonomy', 'current state snapshot']);
const PRODUCTION_SHIPPED_CLAIM_RE = /\b(production|prod|live|endpoint|endpoints|health|smoke|launch)\b/i;
const PROBE_EVIDENCE_RE = /\b(probe|probed|evidence|verified|readback|smoke|non-error|available in the repository|repo-local|documented|documentation|docs?)\b|\[#[-a-f0-9]+\]/i;

function cleanSection(value) {
  return String(value || '')
    .replace(/[✅🔧⛔🟡⏳🔒🔮]/g, '')
    .replace(/\*\*/g, '')
    .replace(/\`/g, '')
    .trim()
    .toLowerCase();
}

function parseRoadmapItems(markdown) {
  const lines = markdown.split(/\r?\n/);
  const items = [];
  let section = null;
  let scope = 'core';

  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      section = cleanSection(heading[1]);
      scope = heading[1].endsWith(NON_CORE_MARKER) ? 'non-core' : 'core';
      continue;
    }

    if (!section || META_SECTIONS.has(section)) continue;

    const item = line.match(/^\s*-\s+(.+?)\s\[(shipped|in flight|pending|blocked|deferred|withdrawn)\](\s·\sowner-gated)?\s*$/);
    if (!item) continue;

    items.push({
      status: item[2],
      scope,
    });
  }

  return items;
}

function lintRoadmap(file) {
  const markdown = fs.readFileSync(file, 'utf8');
  const errors = [];
  const lines = markdown.split(/\r?\n/);
  let section = null;
  let lintBullets = false;

  if (!/^##\s+Status taxonomy\s*$/im.test(markdown)) {
    errors.push('missing required "## Status taxonomy" section');
  }
  if (!/^##\s+Current state snapshot\s*$/im.test(markdown)) {
    errors.push('missing required "## Current state snapshot" section');
  }

  if (/Status:\s*COMPLETE/i.test(markdown) && !COMPLETE_BANNER_RE.test(markdown)) {
    errors.push('completion banner is malformed');
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      const rawSection = heading[1];
      section = cleanSection(rawSection);
      lintBullets = !META_SECTIONS.has(section);
      if (/\bnon[\s-]?core\b/i.test(rawSection) && !rawSection.endsWith(NON_CORE_MARKER)) {
        errors.push(`line ${index + 1}: non-core marker must be exact "${NON_CORE_MARKER}"`);
      }
      continue;
    }

    if (!lintBullets || !section || !/^\s*-\s+/.test(line)) continue;

    if (!ANY_TAG_RE.test(line)) {
      errors.push(`line ${index + 1}: roadmap item missing valid trailing tag`);
      continue;
    }
    if (!ITEM_RE.test(line)) {
      errors.push(`line ${index + 1}: invalid roadmap tag; valid tags are ${VALID_ROADMAP_TAGS.join(', ')}`);
      continue;
    }
    if (!section.includes('decisions') && /\[shipped\]/.test(line) && PRODUCTION_SHIPPED_CLAIM_RE.test(line) && !PROBE_EVIDENCE_RE.test(line)) {
      errors.push(`line ${index + 1}: production-facing shipped item requires live probe, proof marker, or evidence wording`);
    }
  }

  if (COMPLETE_BANNER_RE.test(markdown)) {
    const coreOpen = parseRoadmapItems(markdown)
      .filter((item) => item.scope === 'core' && ['in flight', 'pending', 'blocked'].includes(item.status));
    if (coreOpen.length) {
      errors.push(`completion banner present but ${coreOpen.length} core item(s) remain open`);
    }
  }

  return errors;
}

const files = process.argv.slice(2);
const defaultTargets = ['ROADMAP.md', 'docs/planning/ROADMAP.md'].filter((file) => fs.existsSync(file));
const targets = files.length ? files : defaultTargets;
let failed = false;

if (require.main === module) {
  for (const file of targets) {
    const errors = lintRoadmap(file);
    if (!errors.length) {
      console.log(`roadmap lint passed: ${path.relative(process.cwd(), file)}`);
      continue;
    }

    failed = true;
    console.error(`roadmap lint failed: ${path.relative(process.cwd(), file)}`);
    for (const error of errors) console.error(`- ${error}`);
  }

  if (failed) process.exit(1);
}

module.exports = {
  lintRoadmap,
};
