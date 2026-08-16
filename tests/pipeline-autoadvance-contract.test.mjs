import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';


const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = fs.readFileSync(
  path.join(ROOT, '.github', 'workflows', 'pipeline-autoadvance.yml'),
  'utf8',
);
const EVALUATOR = fs.readFileSync(path.join(ROOT, 'scripts', 'check_pipeline_pr.py'), 'utf8');
const GEMINI_WORKFLOW = fs.readFileSync(
  path.join(ROOT, '.github', 'workflows', 'gemini-review.yml'),
  'utf8',
);


test('auto-advance is default-uit en heeft begrensde triggers plus concurrency', () => {
  assert.match(WORKFLOW, /workflow_run:/);
  assert.match(WORKFLOW, /workflow_dispatch:/);
  assert.match(WORKFLOW, /if: vars\.PIPELINE_AUTOMERGE == 'on'/);
  assert.match(WORKFLOW, /group: pipeline-autoadvance-main-push/);
  assert.match(WORKFLOW, /concurrency:[\s\S]*cancel-in-progress: false/);
});

test('workflow gebruikt vertrouwde main-code en exacte gecontroleerde head', () => {
  assert.match(WORKFLOW, /ref: main/);
  assert.match(WORKFLOW, /MERGEABLE.*UNKNOWN|UNKNOWN.*MERGEABLE/s);
  assert.equal((WORKFLOW.match(/check_pipeline_pr\.py/g) ?? []).length, 2);
  assert.match(WORKFLOW, /Herbevestig gates en reviews direct voor merge/);
  assert.match(WORKFLOW, /gh pr merge[\s\S]*--squash --match-head-commit/);
  assert.match(WORKFLOW, /if: success\(\).*steps\.recheck\.outputs\.decision == 'merge'/);
  assert.match(WORKFLOW, /advance_after_merge\.py[\s\S]*--gate-green/);
  assert.match(WORKFLOW, /git push origin HEAD:main/);
  assert.doesNotMatch(WORKFLOW, /(?:--force|reset --hard|deploy|production)/i);
});

test('evaluator vereist de twee CI-poorten en Gemini-review expliciet', () => {
  for (const name of ['Handoff state guardrail', 'gates', 'review']) {
    assert.match(EVALUATOR, new RegExp(JSON.stringify(name).slice(1, -1)));
  }
  assert.match(EVALUATOR, /CHANGES_REQUESTED/);
  assert.match(EVALUATOR, /APPROVED/);
  assert.match(EVALUATOR, /EXPECTED_REVIEWER = "github-actions"/);
  assert.match(EVALUATOR, /endswith\(bot_suffix\)/);
  assert.match(EVALUATOR, /head_ref\.startswith\("agent\/"\)/);
  assert.match(EVALUATOR, /"pipeline" not in labels/);
});

test('Gemini plaatst een formele fail-closed review in plaats van een comment', () => {
  assert.match(GEMINI_WORKFLOW, /VERDICT: APPROVE/);
  assert.match(GEMINI_WORKFLOW, /VERDICT: REQUEST_CHANGES/);
  assert.match(GEMINI_WORKFLOW, /parse_gemini_verdict\.py/);
  assert.match(GEMINI_WORKFLOW, /pulls\.createReview/);
  assert.match(GEMINI_WORKFLOW, /commit_id: context\.payload\.pull_request\.head\.sha/);
  assert.doesNotMatch(GEMINI_WORKFLOW, /issues\.createComment/);
});

test('workflowrechten zijn beperkt tot checks, PR en inhoud', () => {
  const permissionBlock = WORKFLOW.match(
    /permissions:\r?\n([\s\S]*?)\r?\n\r?\nconcurrency:/,
  )?.[1] ?? '';
  assert.match(permissionBlock, /contents: write/);
  assert.match(permissionBlock, /pull-requests: write/);
  assert.match(permissionBlock, /checks: read/);
  assert.doesNotMatch(permissionBlock, /actions: write|secrets|id-token/);
});
