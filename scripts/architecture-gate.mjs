#!/usr/bin/env node

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = path.resolve(readOption(process.argv.slice(2), '--root') ?? defaultRoot);
const findings = [];
const sourceRoot = existsSync(path.join(projectRoot, 'app', 'src'))
  ? path.join(projectRoot, 'app', 'src')
  : projectRoot;
const sourceFiles = await collectFiles(sourceRoot, (file) => /\.(?:js|mjs|cjs)$/i.test(file));
const sources = await Promise.all(sourceFiles.map(async (file) => ({
  file,
  relative: normalizePath(path.relative(projectRoot, file)),
  content: await readFile(file, 'utf8'),
})));

checkDatabaseState(sources);
checkPermanentConnections(sources);
checkResultTransactions(sources);
checkOwnerFiltering(sources);
checkServerTime(sources);

const fullProject = existsSync(path.join(projectRoot, 'infra', 'docker-compose.yml'));
if (fullProject) await checkProjectContracts(projectRoot);

if (findings.length > 0) {
  console.error(`Architectuurgate A: ROOD (${findings.length} overtreding${findings.length === 1 ? '' : 'en'})`);
  for (const finding of findings) {
    console.error(`- [${finding.rule}] ${finding.file}:${finding.line} — ${finding.message}`);
  }
  process.exitCode = 1;
} else {
  console.log('Architectuurgate A: GROEN — ADR-0002 regels 1 t/m 6 aantoonbaar afgedwongen.');
}

function checkDatabaseState(files) {
  const inMemoryState = /\b(?:sessions?|roundState|roundStatus|attendanceState|presence|presentie)\w*\s*=\s*new\s+(?:Map|Set)\s*\(/gi;
  const fileState = /\b(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream)\s*\([^\n]*(?:session|round|attendance|presentie)/gi;
  for (const source of files) {
    reportMatches('ADR2-1-DB-STATE', source, inMemoryState, 'Autoritatieve sessie-, ronde- of presentiestate mag niet in het procesgeheugen staan.');
    reportMatches('ADR2-1-DB-STATE', source, fileState, 'Autoritatieve state mag niet naar een lokaal runtimebestand worden geschreven.');
  }
}

function checkPermanentConnections(files) {
  const permanentConnection = /\b(?:WebSocket|EventSource|WebSocketServer)\b|text\/event-stream|from\s+['"](?:ws|socket\.io)['"]/gi;
  for (const source of files) {
    reportMatches('ADR2-2-POLLING', source, permanentConnection, 'Permanente WebSocket/SSE-verbindingen zijn niet toegestaan; gebruik polling.');
  }
}

function checkResultTransactions(files) {
  const resultWrite = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:`?round`?|vote_revision|round_result)\b/i;
  for (const source of files) {
    if (!resultWrite.test(source.content)) continue;
    if (!/\bwithTransaction\s*\(/.test(source.content) || !/SELECT[\s\S]{0,240}FOR\s+UPDATE/i.test(source.content)) {
      addFinding(
        'ADR2-3-ATOMIC-RESULT',
        source,
        source.content.search(resultWrite),
        'Een uitslag-rakende schrijfhandeling vereist withTransaction én SELECT ... FOR UPDATE.'
      );
    }
  }
}

function checkOwnerFiltering(files) {
  for (const source of files) {
    if (!/(\/deelnemen\/api\/|owner(?:Route|Api|Controller))/i.test(source.content + source.relative)) continue;
    const unsafeParticipantQuery = /SELECT[\s\S]{0,180}\bFROM\s+participant\b(?![\s\S]{0,180}\bWHERE\b[\s\S]{0,120}\b(?:meeting_id|id)\s*=)/gi;
    const unsafeEntitlementQuery = /SELECT[\s\S]{0,180}\bFROM\s+entitlement\b(?![\s\S]{0,180}\bWHERE\b[\s\S]{0,120}\bparticipant_id\s*=)/gi;
    reportMatches('ADR2-4-ROW-FILTER', source, unsafeParticipantQuery, 'Eigenaars-API selecteert deelnemers zonder server-side scopefilter.');
    reportMatches('ADR2-4-ROW-FILTER', source, unsafeEntitlementQuery, 'Eigenaars-API selecteert rechten zonder server-side participantfilter.');
  }
}

function checkServerTime(files) {
  const auditWrite = /(?:INSERT\s+INTO\s+audit_event|accepted_at)[\s\S]{0,260}/gi;
  for (const source of files) {
    for (const match of source.content.matchAll(auditWrite)) {
      if (/\b(?:Date\.now\s*\(|new\s+Date\s*\(|clientTime|client_time|req\.body\.(?:time|timestamp))/.test(match[0])) {
        addFinding('ADR2-5-SERVER-UTC', source, match.index, 'Audit- of acceptatietijd mag niet van de client of Node-klok komen; gebruik database-servertijd UTC.');
      }
    }
  }
}

async function checkProjectContracts(root) {
  const schema = await readRequired(root, 'infra/mysql/init/01-schema.sql', 'ADR2-1-DB-STATE');
  for (const table of ['session', 'attendance', 'round', 'vote_revision', 'audit_event']) {
    if (!new RegExp(`CREATE\\s+TABLE\\s+${table}\\b`, 'i').test(schema.content)) {
      addFinding('ADR2-1-DB-STATE', schema, 0, `Databasetabel ${table} ontbreekt voor autoritatieve state.`);
    }
  }

  const server = await readRequired(root, 'app/src/server.js', 'ADR2-2-POLLING');
  const loadtest = await readRequired(root, 'infra/loadtest/vote-burst.js', 'ADR2-2-POLLING');
  if (!/ETag/i.test(server.content)) addFinding('ADR2-2-POLLING', server, 0, 'Statuspolling mist ETag-ondersteuning.');
  if (!/Math\.random\(\)/.test(loadtest.content)) addFinding('ADR2-2-POLLING', loadtest, 0, 'Pollingtest mist jitter.');

  const compose = await readRequired(root, 'infra/docker-compose.yml', 'ADR2-6-PROXY-IP');
  const caddy = await readRequired(root, 'infra/proxy/Caddyfile', 'ADR2-6-PROXY-IP');
  const dockerfile = await readRequired(root, 'infra/Dockerfile', 'ADR2-1-DB-STATE');
  if (!/TRUST_PROXY:\s*["']?1["']?/.test(compose.content)) {
    addFinding('ADR2-6-PROXY-IP', compose, 0, 'De app vertrouwt de gecontroleerde proxylaag niet expliciet.');
  }
  if (!/header_up\s+X-Forwarded-For\s+\{remote_host\}/.test(caddy.content)) {
    addFinding('ADR2-6-PROXY-IP', caddy, 0, 'De proxy zet X-Forwarded-For niet vanuit remote_host.');
  }
  if (!/mem_limit:\s*2g/i.test(compose.content)) {
    addFinding('ADR2-1-DB-STATE', compose, 0, 'De test-app mist de 2 GB shared-hosting-geheugenlimiet.');
  }
  if (!/CMD\s*\[\s*["']node["']\s*,\s*["']src\/server\.js["']\s*\]/.test(dockerfile.content)) {
    addFinding('ADR2-1-DB-STATE', dockerfile, 0, 'De container moet exact één Node-proces starten.');
  }
  const dockerInstructions = dockerfile.content
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
  if (/\b(?:pm2|cluster\.fork|node:cluster)\b/i.test(dockerInstructions)) {
    addFinding('ADR2-1-DB-STATE', dockerfile, 0, 'Clustering/PM2 is niet toegestaan op het doelplatform.');
  }
}

async function readRequired(root, relative, rule) {
  const file = path.join(root, relative);
  if (!existsSync(file)) {
    const placeholder = { file, relative: normalizePath(relative), content: '' };
    addFinding(rule, placeholder, 0, 'Verplicht architectuurcontract ontbreekt.');
    return placeholder;
  }
  return { file, relative: normalizePath(relative), content: await readFile(file, 'utf8') };
}

function reportMatches(rule, source, expression, message) {
  expression.lastIndex = 0;
  for (const match of source.content.matchAll(expression)) addFinding(rule, source, match.index, message);
}

function addFinding(rule, source, index, message) {
  findings.push({ rule, file: source.relative, line: lineNumber(source.content, index), message });
}

function lineNumber(content, index = 0) {
  return content.slice(0, Math.max(index, 0)).split('\n').length;
}

async function collectFiles(directory, accept) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(fullPath, accept));
    else if (accept(fullPath)) files.push(fullPath);
  }
  return files;
}

function readOption(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function normalizePath(value) {
  return value.replaceAll(path.sep, '/');
}
