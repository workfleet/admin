#!/usr/bin/env node
/*
 * Schema drift check: does `supabase/schema.sql` + `supabase/migrations/*.sql`
 * actually describe the database the app is pointed at?
 *
 * This repo has been wrong about that before. `jobs.duration_minutes` was
 * added by hand in the Supabase dashboard and never written down, so a fresh
 * project built from these files came up missing a column every insert into
 * `jobs` depends on - and nothing noticed, because the live database happened
 * to have it. A passing app is no evidence the migration history is complete.
 *
 * Rather than needing a throwaway Postgres to replay the files into, this
 * reads the live shape straight off PostgREST's OpenAPI document (every table
 * and column the API exposes) and compares it against what the SQL files say
 * should exist. Read-only, and it reads schema metadata only - never rows.
 *
 *   node scripts/schema-drift-check.js
 *
 * Exits non-zero when the files and the database disagree, so it can gate a
 * release. Anything it reports is either a column to write a migration for, or
 * a migration that never got applied.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SCHEMA = path.join(ROOT, 'supabase', 'schema.sql');
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');

// Tables PostgREST exposes that this repo does not (and should not) define -
// Supabase's own managed schemas surface here too.
const IGNORED_TABLES = new Set([]);

// ---------------------------------------------------------------------------
// Reading the SQL files
// ---------------------------------------------------------------------------

// Function bodies are dollar-quoted and full of the same commas and parens the
// column parser splits on, so they come out before anything else looks at the
// text. Same for comments, which otherwise contribute stray keywords.
function stripNoise(sql) {
  return sql
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
}

// Splits on commas that sit at paren depth zero, so `numeric(10,2)` and
// `check (x in ('a','b'))` stay in one piece.
function splitTopLevel(body) {
  const parts = [];
  let depth = 0;
  let current = '';
  let quote = null;
  for (const ch of body) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; current += ch; continue; }
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { parts.push(current); current = ''; continue; }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

// A table body mixes column definitions with table-level constraints; only the
// former name a column, and they are told apart by their leading keyword.
const CONSTRAINT_KEYWORDS = new Set([
  'primary', 'foreign', 'unique', 'check', 'constraint', 'exclude', 'like',
]);

function columnsFromTableBody(body) {
  const columns = [];
  for (const part of splitTopLevel(body)) {
    const first = part.split(/\s+/)[0].toLowerCase().replace(/"/g, '');
    if (CONSTRAINT_KEYWORDS.has(first)) continue;
    if (!/^[a-z_][a-z0-9_]*$/.test(first)) continue;
    columns.push(first);
  }
  return columns;
}

// Finds the matching close paren for the create-table body, which nested
// types and check constraints make impossible to do with a regex alone.
function extractParenBody(sql, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < sql.length; i += 1) {
    if (sql[i] === '(') depth += 1;
    else if (sql[i] === ')') {
      depth -= 1;
      if (depth === 0) return sql.slice(openIndex + 1, i);
    }
  }
  return null;
}

function applyStatements(sql, tables, sourceLabel) {
  const clean = stripNoise(sql);

  // create table [if not exists] <name> ( ... )
  const createRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)\s*\(/gi;
  let match;
  while ((match = createRe.exec(clean)) !== null) {
    const body = extractParenBody(clean, createRe.lastIndex - 1);
    if (body === null) continue;
    tables.set(match[1].toLowerCase(), {
      columns: new Set(columnsFromTableBody(body)),
      source: sourceLabel,
    });
  }

  // drop table [if exists] <name>
  const dropRe = /drop\s+table\s+(?:if\s+exists\s+)?([a-z_][a-z0-9_]*)/gi;
  while ((match = dropRe.exec(clean)) !== null) tables.delete(match[1].toLowerCase());

  // alter table <name> <actions>, where one statement may carry several
  // comma-separated add/drop column clauses (0011 adds lat and lng that way).
  const alterRe = /alter\s+table\s+(?:only\s+)?([a-z_][a-z0-9_]*)\s+([^;]*);/gi;
  while ((match = alterRe.exec(clean)) !== null) {
    const table = match[1].toLowerCase();
    const entry = tables.get(table);
    if (!entry) continue;
    for (const action of splitTopLevel(match[2])) {
      const add = action.match(/^add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/i);
      if (add) { entry.columns.add(add[1].toLowerCase()); continue; }
      const drop = action.match(/^drop\s+column\s+(?:if\s+exists\s+)?([a-z_][a-z0-9_]*)/i);
      if (drop) { entry.columns.delete(drop[1].toLowerCase()); continue; }
      const rename = action.match(/^rename\s+column\s+([a-z_][a-z0-9_]*)\s+to\s+([a-z_][a-z0-9_]*)/i);
      if (rename) {
        entry.columns.delete(rename[1].toLowerCase());
        entry.columns.add(rename[2].toLowerCase());
      }
    }
  }
}

function readExpectedSchema() {
  const tables = new Map();
  applyStatements(fs.readFileSync(SCHEMA, 'utf8'), tables, 'schema.sql');

  const files = fs.readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    applyStatements(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8'), tables, file);
  }
  return { tables, files };
}

// ---------------------------------------------------------------------------
// Reading the live database
// ---------------------------------------------------------------------------

function readEnv() {
  const fromProcess = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  if (fromProcess.url && fromProcess.key) return fromProcess;

  const envPath = path.join(ROOT, '.env.local');
  if (!fs.existsSync(envPath)) return fromProcess;

  const parsed = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i === -1 || line.trimStart().startsWith('#')) continue;
    parsed[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return {
    url: fromProcess.url || parsed.NEXT_PUBLIC_SUPABASE_URL,
    key: fromProcess.key || parsed.SUPABASE_SERVICE_ROLE_KEY,
  };
}

async function readLiveSchema({ url, key }) {
  const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/openapi+json' },
  });
  if (!res.ok) throw new Error(`PostgREST returned ${res.status} ${res.statusText}`);

  const spec = await res.json();
  const definitions = spec.definitions || spec.components?.schemas || {};
  const tables = new Map();
  for (const [name, def] of Object.entries(definitions)) {
    if (IGNORED_TABLES.has(name)) continue;
    tables.set(name.toLowerCase(), new Set(Object.keys(def.properties || {}).map((c) => c.toLowerCase())));
  }
  return tables;
}

// ---------------------------------------------------------------------------

async function main() {
  const { tables: expected, files } = readExpectedSchema();
  console.log(`Read ${files.length} migrations + schema.sql -> ${expected.size} tables expected.\n`);

  const env = readEnv();
  if (!env.url || !env.key) {
    console.error('Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (env or .env.local).');
    process.exit(2);
  }

  const live = await readLiveSchema(env);
  console.log(`Live database exposes ${live.size} tables.\n`);

  const problems = [];

  for (const [table, columns] of live) {
    const entry = expected.get(table);
    if (!entry) {
      problems.push(`TABLE ONLY IN DATABASE: ${table} - exists live, no SQL file creates it.`);
      continue;
    }
    for (const column of columns) {
      if (!entry.columns.has(column)) {
        problems.push(`COLUMN ONLY IN DATABASE: ${table}.${column} - exists live, no SQL file creates it.`);
      }
    }
  }

  for (const [table, entry] of expected) {
    const columns = live.get(table);
    if (!columns) {
      problems.push(`TABLE ONLY IN FILES: ${table} (${entry.source}) - the SQL creates it, the database has not got it.`);
      continue;
    }
    for (const column of entry.columns) {
      if (!columns.has(column)) {
        problems.push(`COLUMN ONLY IN FILES: ${table}.${column} - the SQL creates it, the database has not got it.`);
      }
    }
  }

  if (problems.length === 0) {
    console.log('No drift. The SQL files describe the live database exactly.');
    return;
  }

  console.log(`${problems.length} discrepanc${problems.length === 1 ? 'y' : 'ies'}:\n`);
  for (const p of problems.sort()) console.log(`  - ${p}`);
  console.log('\nEach "ONLY IN DATABASE" line is a change made by hand that needs writing');
  console.log('into a migration. Each "ONLY IN FILES" line is a migration that was never');
  console.log('applied to this database - run it in the Supabase SQL editor.');
  // Set rather than process.exit(): exiting while the fetch's socket is still
  // closing trips a libuv assertion on Node 24 for Windows, which turns a
  // readable "1 discrepancy" into a crash dump.
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(`Failed: ${err.message}`);
  process.exitCode = 2;
});
