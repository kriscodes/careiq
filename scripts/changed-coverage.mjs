import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const workspaces = [
  ['api', 'apps/api'],
  ['web', 'apps/web'],
  ['marketing', 'apps/marketing'],
  ['i18n', 'packages/i18n'],
  ['interview-contract', 'packages/interview-contract'],
];
const minimum = 80;

/** JSX indentation/newlines are normalized by the JSX runtime transform itself. */
function jsxText(raw) {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  let lastContent = 0;
  for (let index = 0; index < lines.length; index++) {
    if (/[^\t ]/.test(lines[index])) {
      lastContent = index;
    }
  }
  let text = '';
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index].replace(/\t/g, ' ');
    if (index > 0) {
      line = line.replace(/^ +/, '');
    }
    if (index < lines.length - 1) {
      line = line.replace(/ +$/, '');
    }
    if (line) {
      text += line + (index !== lastContent ? ' ' : '');
    }
  }
  return text;
}

/** Describe runtime syntax, not formatting or erased TypeScript declarations. */
export function runtimeSyntax(source, filename) {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  if (file.parseDiagnostics.length) {
    throw new Error(`Cannot parse coverage source: ${filename}`);
  }
  const tokens = [];
  function visit(node) {
    if (ts.isJsxExpression(node) && !node.expression) {
      return;
    }
    if (
      ts.isJsxText(node) ||
      (ts.isJsxExpression(node) &&
        node.expression &&
        ts.isStringLiteral(node.expression) &&
        /^\s*$/.test(node.expression.text))
    ) {
      const value = ts.isJsxText(node) ? jsxText(node.text) : node.expression.text;
      if (value) {
        const previous = tokens.at(-1);
        if (previous?.jsxText !== undefined) {
          previous.jsxText += value;
          previous.key = JSON.stringify(['jsx-text', previous.jsxText]);
        } else {
          tokens.push({
            key: JSON.stringify(['jsx-text', value]),
            jsxText: value,
            line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
          });
        }
      }
      return;
    }
    const parent = node.parent;
    // ESLint's braces-only rewrite preserves a single control-flow statement.
    // Do not flatten ordinary lexical blocks or move declarations across scopes.
    if (
      ts.isBlock(node) &&
      node.statements.length === 1 &&
      parent &&
      (ts.isIfStatement(parent) || ts.isIterationStatement(parent, false)) &&
      !ts.isFunctionDeclaration(node.statements[0]) &&
      !ts.isClassDeclaration(node.statements[0])
    ) {
      visit(node.statements[0]);
      return;
    }
    if (
      ts.isTypeNode(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isTypeParameterDeclaration(node) ||
      node.kind === ts.SyntaxKind.EndOfFileToken ||
      ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Ambient ||
      (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) ||
      (ts.isExportDeclaration(node) && node.isTypeOnly) ||
      ((ts.isImportSpecifier(node) || ts.isExportSpecifier(node)) && node.isTypeOnly)
    ) {
      return;
    }
    if (
      ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isParenthesizedExpression(node)
    ) {
      visit(node.expression);
      return;
    }
    const value =
      ts.isIdentifier(node) ||
      ts.isPrivateIdentifier(node) ||
      ts.isLiteralExpression(node) ||
      ts.isJsxText(node)
        ? node.text
        : '';
    const declarationFlags = ts.isVariableDeclarationList(node)
      ? node.flags &
        (ts.NodeFlags.Let | ts.NodeFlags.Const | ts.NodeFlags.Using | ts.NodeFlags.AwaitUsing)
      : 0;
    const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
    const endLine =
      file.getLineAndCharacterOfPosition(Math.max(node.getStart(file), node.end - 1)).line + 1;
    tokens.push({ key: JSON.stringify([node.kind, value, declarationFlags]), line });
    ts.forEachChild(node, visit);
    tokens.push({ key: `end:${node.kind}`, line: endLine });
  }
  visit(file);
  return tokens;
}

/** Git's sequence diff scales to the large workflow modules without quadratic JS memory. */
export function changedRuntimeLines(before, after, filename) {
  const oldTokens = runtimeSyntax(before, filename);
  const newTokens = runtimeSyntax(after, filename);
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'careiq-coverage-diff-'));
  try {
    const oldPath = path.join(temporary, 'before');
    const newPath = path.join(temporary, 'after');
    writeFileSync(oldPath, oldTokens.map((token) => token.key).join('\n') + '\n');
    writeFileSync(newPath, newTokens.map((token) => token.key).join('\n') + '\n');
    const result = spawnSync(
      'git',
      ['diff', '--no-index', '--no-ext-diff', '--unified=0', oldPath, newPath],
      {
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
      },
    );
    if (result.error || ![0, 1].includes(result.status)) {
      throw new Error(`Cannot compare changed coverage syntax: ${filename}`);
    }
    const lines = new Set();
    for (const match of result.stdout.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
      const start = Number(match[1]) - 1;
      const count = match[2] === undefined ? 1 : Number(match[2]);
      for (const token of newTokens.slice(start, start + count)) {
        lines.add(token.line);
      }
    }
    return lines;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

export function parseLcov(source, directory) {
  const files = new Map();
  let current;
  for (const line of source.split(/\r?\n/)) {
    if (line.startsWith('SF:')) {
      current = new Map();
      const filename = path.resolve(directory, line.slice(3));
      if (files.has(filename)) {
        throw new Error(`Duplicate LCOV source: ${filename}`);
      }
      files.set(filename, current);
    } else if (line.startsWith('DA:')) {
      const match = /^DA:(\d+),(\d+)(?:,[^,]+)?$/.exec(line);
      if (!current || !match || Number(match[1]) < 1) {
        throw new Error('Invalid executable-line coverage record.');
      }
      current.set(Number(match[1]), Number(match[2]));
    } else if (line === 'end_of_record') {
      current = undefined;
    }
  }
  if (current !== undefined) {
    throw new Error('Incomplete LCOV record.');
  }
  if (!files.size) {
    throw new Error('Coverage report contains no source files.');
  }
  return files;
}

export function checkChangedCoverage(changes, coverage, threshold = minimum) {
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 100) {
    throw new Error('Changed coverage threshold must be between zero and 100.');
  }
  let covered = 0;
  let total = 0;
  const uncovered = [];
  for (const change of changes) {
    const changed = changedRuntimeLines(change.before, change.after, change.filename);
    if (!changed.size) {
      continue;
    }
    const executable = coverage.get(path.resolve(change.filename));
    if (!executable) {
      throw new Error(`Changed source is missing from coverage: ${change.filename}`);
    }
    if (!executable.size) {
      throw new Error(
        `Changed runtime source has no executable coverage records: ${change.filename}`,
      );
    }
    for (const line of [...changed].sort((left, right) => left - right)) {
      if (!executable.has(line)) {
        continue;
      }
      total++;
      if (executable.get(line) > 0) {
        covered++;
      } else {
        uncovered.push(`${change.filename}:${line}`);
      }
    }
  }
  const percentage = total ? (100 * covered) / total : 100;
  return {
    covered,
    total,
    percentage,
    minimum: threshold,
    passed: percentage >= threshold,
    uncovered,
  };
}

export function sourceWorkspace(filename) {
  if (!/\.(?:[cm]?js|jsx|ts|tsx)$/.test(filename) || /\.d\.ts$/.test(filename)) {
    return undefined;
  }
  if (/(?:^|\/)(?:tests|node_modules|dist)\//.test(filename)) {
    return undefined;
  }
  return workspaces.find(([, directory]) =>
    filename.startsWith(directory.startsWith('apps/') ? `${directory}/src/` : `${directory}/`),
  );
}

export function loadChanges(root, baseRef) {
  if (!baseRef) {
    throw new Error(
      'Set COVERAGE_BASE_SHA to the reviewed base commit; no implicit fallback is allowed.',
    );
  }
  const git = (args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  let base;
  try {
    base = git(['rev-parse', '--verify', '--end-of-options', `${baseRef}^{commit}`]).trim();
  } catch {
    throw new Error(
      'Coverage base commit is unavailable. Check out full history and supply the actual base SHA.',
    );
  }
  const entries = git(['diff', '--name-status', '-z', '--find-renames', base, '--'])
    .split('\0')
    .filter(Boolean);
  const candidates = new Map();
  for (let index = 0; index < entries.length; ) {
    const status = entries[index++];
    const oldPath = entries[index++];
    const newPath = /^[RC]/.test(status) ? entries[index++] : oldPath;
    if (!status.startsWith('D')) {
      candidates.set(newPath, status.startsWith('A') || status.startsWith('C') ? null : oldPath);
    }
  }
  for (const filename of git(['ls-files', '--others', '--exclude-standard', '-z'])
    .split('\0')
    .filter(Boolean)) {
    candidates.set(filename, null);
  }
  const changes = [];
  for (const [filename, previous] of candidates) {
    if (!sourceWorkspace(filename)) {
      continue;
    }
    const absolute = path.join(root, filename);
    if (!existsSync(absolute)) {
      throw new Error(`Changed source is unavailable: ${filename}`);
    }
    changes.push({
      filename: absolute,
      before: previous ? git(['show', `${base}:${previous}`]) : '',
      after: readFileSync(absolute, 'utf8'),
    });
  }
  return changes;
}

const hash = (value) => createHash('sha256').update(value).digest('hex');

// Include test code and toolchain/config inputs as well as runtime source: changing
// tests must not allow an older successful report to masquerade as a fresh run.
function coverageInput(filename) {
  return (
    workspaces.some(([, directory]) => filename.startsWith(`${directory}/`)) ||
    [
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'coverage-policy.json',
      '.node-version',
      '.nvmrc',
      '.npmrc',
      'scripts/test-coverage.mjs',
      'scripts/coverage-policy.mjs',
      'scripts/coverage-test-reporter.mjs',
      'scripts/changed-coverage.mjs',
    ].includes(filename)
  );
}

export function coverageSourceDigest(root) {
  const filenames = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    {
      cwd: root,
      encoding: 'utf8',
    },
  )
    .split('\0')
    .filter(
      (filename) => filename && coverageInput(filename) && existsSync(path.join(root, filename)),
    );
  const unique = [...new Set(filenames)].sort();
  return hash(
    unique
      .map((filename) => `${filename}\0${hash(readFileSync(path.join(root, filename)))}\n`)
      .join(''),
  );
}

export function writeCoverageProvenance(root, initialSourceDigest) {
  if (coverageSourceDigest(root) !== initialSourceDigest) {
    throw new Error(
      'Source files changed during coverage. Run coverage again on a stable checkout.',
    );
  }
  const reports = Object.fromEntries(
    workspaces.map(([name]) => [
      name,
      hash(readFileSync(path.join(root, 'coverage', name, 'lcov.info'))),
    ]),
  );
  writeFileSync(
    path.join(root, 'coverage', 'provenance.json'),
    JSON.stringify(
      {
        version: 1,
        sourceDigest: initialSourceDigest,
        reports,
      },
      null,
      2,
    ) + '\n',
  );
}

export function verifyCoverageProvenance(root) {
  const filename = path.join(root, 'coverage', 'provenance.json');
  if (!existsSync(filename)) {
    throw new Error('Coverage provenance is missing. Run test:coverage first.');
  }
  const provenance = JSON.parse(readFileSync(filename, 'utf8'));
  if (provenance.version !== 1 || provenance.sourceDigest !== coverageSourceDigest(root)) {
    throw new Error('Coverage is stale for this source tree. Run test:coverage again.');
  }
  for (const [name] of workspaces) {
    const report = path.join(root, 'coverage', name, 'lcov.info');
    if (!existsSync(report) || provenance.reports?.[name] !== hash(readFileSync(report))) {
      throw new Error(`Coverage report is missing or changed: ${name}`);
    }
  }
}

export function runChangedCoverage(root, baseRef) {
  verifyCoverageProvenance(root);
  const coverage = new Map();
  for (const [name, directory] of workspaces) {
    const report = path.join(root, 'coverage', name, 'lcov.info');
    if (!existsSync(report)) {
      throw new Error(
        `Missing ${name} coverage report. Run test:coverage before changed-code coverage.`,
      );
    }
    for (const [filename, lines] of parseLcov(
      readFileSync(report, 'utf8'),
      path.join(root, directory),
    )) {
      coverage.set(filename, lines);
    }
  }
  return checkChangedCoverage(loadChanges(root, baseRef), coverage);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const result = runChangedCoverage(root, process.env.COVERAGE_BASE_SHA);
    console.log(
      `Changed executable lines: ${result.covered}/${result.total} (${result.percentage.toFixed(2)}%); required ${result.minimum}%.`,
    );
    if (!result.passed) {
      console.error(`Uncovered changed lines:\n${result.uncovered.join('\n')}`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
