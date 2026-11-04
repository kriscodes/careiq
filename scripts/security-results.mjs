import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Fail on material security findings without printing source snippets or messages. */
export function codeqlViolations(sarif) {
  if (sarif?.version !== '2.1.0' || !Array.isArray(sarif.runs) || !sarif.runs.length) {
    throw new Error('Missing CodeQL SARIF analysis.');
  }
  const failures = [];
  for (const run of sarif.runs) {
    if (
      !run.tool?.driver?.name?.includes('CodeQL') ||
      !Array.isArray(run.tool.driver.rules) ||
      !run.tool.driver.rules.length ||
      run.invocations?.some((item) => item.executionSuccessful === false)
    ) {
      throw new Error('Incomplete or failed CodeQL analysis.');
    }
    if (run.results !== undefined && !Array.isArray(run.results)) {
      throw new Error('Invalid CodeQL results.');
    }
    for (const result of run.results ?? []) {
      const rule = run.tool.driver.rules.find((item) => item.id === result.ruleId);
      if (!rule) {
        throw new Error('CodeQL result has no rule metadata.');
      }
      const severity = Number(rule.properties?.['security-severity'] ?? 0);
      const level = result.level ?? rule.defaultConfiguration?.level ?? 'warning';
      if (!Number.isFinite(severity)) {
        throw new Error('Invalid CodeQL security severity.');
      }
      if (severity >= 4 || ['warning', 'error'].includes(level)) {
        failures.push({ rule: result.ruleId, severity, level });
      }
    }
  }
  return failures;
}

/** All configured languages must produce rule-bearing analysis, even with zero findings. */
export function verifyCodeqlReports(reports) {
  const expectedPrefixes = ['js/', 'py/', 'actions/'];
  const failures = reports.flatMap(codeqlViolations);
  const rules = reports.flatMap((report) =>
    report.runs.flatMap((run) => run.tool.driver.rules.map((rule) => rule.id)),
  );
  if (expectedPrefixes.some((prefix) => !rules.some((rule) => rule.startsWith(prefix)))) {
    throw new Error(
      'CodeQL reports must include JavaScript/TypeScript, Python and Actions analysis.',
    );
  }
  return failures;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) {
      throw new Error('Provide the CodeQL SARIF directory.');
    }
    const directory = process.argv[2];
    const files = readdirSync(directory).filter((file) => file.endsWith('.sarif'));
    if (!files.length) {
      throw new Error('No CodeQL SARIF reports found.');
    }
    const failures = verifyCodeqlReports(
      files.map((file) => JSON.parse(readFileSync(path.join(directory, file), 'utf8'))),
    );
    if (failures.length) {
      throw new Error(
        `CodeQL blocked release: ${failures.length} finding(s), rules ${[...new Set(failures.map((item) => item.rule))].join(', ')}.`,
      );
    }
    console.log(`CodeQL gate passed for ${files.length} analysis report(s).`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
