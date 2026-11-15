#!/usr/bin/env node
// Judges a crawl output directory against the design system's promises. Where
// verify-report.mjs proves a crawl is complete, this script reads what the
// reports found and fails when a screen breaks one of these rules:
//
//   - color contrast: no axe color-contrast violation in either theme. Text
//     that cannot be read is a defect however small the failing area.
//   - accessibility: no serious or critical axe violation of any rule.
//   - type scale: every computed font size is one of ALLOWED_FONT_SIZES. A size
//     outside the scale means a component escaped the type tokens.
//   - fonts: every leading font family is a Red Hat family. A fallback font in
//     use means the bundled face did not load or a component names its own.
//   - hosts: no request to any host but the application's own. The fonts, icons
//     and scripts ship with the application; a request elsewhere leaks the
//     visit to a third party and breaks on networks without internet access.
//
// A report without the design fields (a crawl made before the crawler recorded
// them) cannot be judged and fails. The number of color-contrast nodes axe could
// not decide is printed and never fails the gate: undecided is neither a pass
// nor a finding, and has to be looked at by a person.
//
// Usage: design-gate.mjs <crawl output directory>
// Prints "ok <check>", "FAIL <screen>: <why>" and "info <what>" lines. Exits 0
// when no check failed, 1 when one did, 2 when the directory cannot be read.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// The type scale: label, body, heading and page title.
export const ALLOWED_FONT_SIZES = ['12px', '14px', '18px', '28px'];

const RED_HAT_FAMILIES = ['redhattext', 'redhatdisplay', 'redhatmono'];

// "Red Hat Text", the legacy "RedHatText" and the variable-font name
// "Red Hat Text VF" are the same family.
export function isRedHatFamily(name) {
  return RED_HAT_FAMILIES.includes(
    name.toLowerCase().replace(/\s+/g, '').replace(/vf$/, ''),
  );
}

const DESIGN_FIELDS = ['fontSizes', 'fontFamilies', 'foreignRequests'];

class BadInput extends Error {}

function readJson(path, what) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new BadInput(
      `${what} cannot be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

const list = (value) => (Array.isArray(value) ? value : []);

// The checks of one screen report: { check, what, why } for every finding.
function findings(report) {
  const found = [];
  const violations = list(report.axe?.violations);
  const contrast = violations.filter((v) => v.id === 'color-contrast');
  if (contrast.length) {
    const nodes = contrast.reduce((sum, v) => sum + (v.nodes ?? 0), 0);
    found.push({
      check: 'color contrast',
      why: `color-contrast violation on ${nodes} nodes`,
    });
  }
  const serious = violations.filter(
    (v) =>
      v.id !== 'color-contrast' &&
      (v.impact === 'serious' || v.impact === 'critical'),
  );
  if (serious.length) {
    found.push({
      check: 'accessibility',
      why: serious.map((v) => `${v.id} (${v.impact})`).join(', '),
    });
  }
  if (DESIGN_FIELDS.some((field) => !Array.isArray(report[field]))) {
    found.push({ check: 'design fields', why: 'report lacks design fields' });
    return found;
  }
  const sizes = report.fontSizes.filter((s) => !ALLOWED_FONT_SIZES.includes(s));
  if (sizes.length) {
    found.push({ check: 'font sizes', why: `font sizes ${sizes.join(', ')}` });
  }
  const families = report.fontFamilies.filter((name) => !isRedHatFamily(name));
  if (families.length) {
    found.push({
      check: 'font families',
      why: `font families ${families.join(', ')}`,
    });
  }
  if (report.foreignRequests.length) {
    found.push({
      check: 'hosts',
      why: `requests to ${report.foreignRequests.join(', ')}`,
    });
  }
  return found;
}

const CHECKS = [
  'color contrast',
  'accessibility',
  'design fields',
  'font sizes',
  'font families',
  'hosts',
];

// Returns { checks: [{ ok, what, why }], info: [text] }. Throws BadInput when
// the directory, its index or a report it names cannot be read.
export function designGate(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new BadInput(`${dir} is not a directory`);
  }
  const index = readJson(join(dir, 'index.json'), 'index.json');
  if (!Array.isArray(index?.screens) || index.screens.length === 0) {
    throw new BadInput('index.json lists no screens');
  }

  const failed = new Map(CHECKS.map((check) => [check, []]));
  let undecided = 0;
  for (const screen of index.screens) {
    const report = readJson(join(dir, screen.file), screen.file);
    const name = `${screen.route} ${screen.theme} ${screen.viewport}`;
    undecided += Number.isInteger(report.axe?.incompleteContrast)
      ? report.axe.incompleteContrast
      : 0;
    for (const { check, why } of findings(report)) {
      failed.get(check).push({ ok: false, what: `${check} ${name}`, why });
    }
  }

  const checks = [];
  for (const check of CHECKS) {
    const broken = failed.get(check);
    if (broken.length) {
      checks.push(...broken);
    } else if (check !== 'design fields') {
      checks.push({
        ok: true,
        what: `${check} on ${index.screens.length} screens`,
        why: '',
      });
    }
  }
  return {
    checks,
    info: [
      `color contrast checks axe could not complete: ${undecided} (look at them by hand, they do not fail the gate)`,
    ],
  };
}

export function main(argv) {
  const dir = argv[0];
  if (!dir) {
    console.error('usage: design-gate.mjs <crawl output directory>');
    return 2;
  }
  let result;
  try {
    result = designGate(dir);
  } catch (error) {
    if (error instanceof BadInput) {
      console.error(error.message);
      return 2;
    }
    throw error;
  }
  for (const check of result.checks) {
    console.log(
      check.ok ? `ok ${check.what}` : `FAIL ${check.what}: ${check.why}`,
    );
  }
  for (const line of result.info) {
    console.log(`info ${line}`);
  }
  const failed = result.checks.filter((check) => !check.ok).length;
  console.log(
    failed ? `${failed} findings, the gate failed` : 'the gate passed',
  );
  return failed ? 1 : 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main(process.argv.slice(2));
}
