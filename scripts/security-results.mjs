import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function codeqlRuleComponents(run) {
  if (
    !run.tool?.driver?.name?.includes('CodeQL') ||
    (run.tool.extensions !== undefined && !Array.isArray(run.tool.extensions)) ||
    run.invocations?.some((item) => item.executionSuccessful === false)
  ) {
    throw new Error('Incomplete or failed CodeQL analysis.');
  }
  // The CodeQL Action groups query-pack rules into SARIF tool extensions.
  const components = [run.tool.driver, ...(run.tool.extensions ?? [])];
  for (const component of components) {
    if (
      !component ||
      (component.rules !== undefined && !Array.isArray(component.rules)) ||
      (component.rules ?? []).some((rule) => typeof rule?.id !== 'string' || !rule.id) ||
      new Set((component.rules ?? []).map((rule) => rule.id)).size !==
        (component.rules ?? []).length
    ) {
      throw new Error('Invalid CodeQL rule metadata.');
    }
  }
  if (!components.some((component) => component.rules?.length)) {
    throw new Error('Incomplete or failed CodeQL analysis.');
  }
  return components;
}

function resultRule(result, components) {
  const reference = result.rule;
  const componentReference = reference?.toolComponent;
  const ruleId = reference?.id ?? result.ruleId;
  if (
    reference?.id !== undefined &&
    result.ruleId !== undefined &&
    reference.id !== result.ruleId
  ) {
    throw new Error('CodeQL result has inconsistent rule metadata.');
  }
  let selectedComponents = components;
  if (componentReference !== undefined) {
    // SARIF extension indexes are relative to tool.extensions, excluding the driver.
    selectedComponents = components
      .slice(1)
      .filter(
        (component, index) =>
          (componentReference.index === undefined || componentReference.index === index) &&
          (componentReference.name === undefined || componentReference.name === component.name) &&
          (componentReference.guid === undefined || componentReference.guid === component.guid),
      );
    if (
      (componentReference.index === undefined &&
        componentReference.name === undefined &&
        componentReference.guid === undefined) ||
      selectedComponents.length !== 1
    ) {
      throw new Error('CodeQL result has invalid tool component metadata.');
    }
  } else if (reference !== undefined || result.ruleIndex !== undefined) {
    selectedComponents = [components[0]];
  }
  if (
    reference?.index !== undefined &&
    result.ruleIndex !== undefined &&
    reference.index !== result.ruleIndex
  ) {
    throw new Error('CodeQL result has inconsistent rule index metadata.');
  }
  const index = reference?.index ?? result.ruleIndex;
  if (
    index !== undefined &&
    (!Number.isSafeInteger(index) || index < 0 || selectedComponents.length !== 1)
  ) {
    throw new Error('CodeQL result has invalid rule index metadata.');
  }
  const matches = selectedComponents.flatMap((component) => {
    const rules = component.rules ?? [];
    return index === undefined
      ? rules.filter((rule) => rule.id === ruleId)
      : [rules[index]].filter(Boolean);
  });
  if (matches.length !== 1 || (ruleId !== undefined && matches[0].id !== ruleId)) {
    throw new Error('CodeQL result has no unique matching rule metadata.');
  }
  return matches[0];
}

/** Fail on material security findings without printing source snippets or messages. */
export function codeqlViolations(sarif) {
  if (sarif?.version !== '2.1.0' || !Array.isArray(sarif.runs) || !sarif.runs.length) {
    throw new Error('Missing CodeQL SARIF analysis.');
  }
  const failures = [];
  for (const run of sarif.runs) {
    const components = codeqlRuleComponents(run);
    if (run.results !== undefined && !Array.isArray(run.results)) {
      throw new Error('Invalid CodeQL results.');
    }
    for (const result of run.results ?? []) {
      const rule = resultRule(result, components);
      const severity = Number(rule.properties?.['security-severity'] ?? 0);
      const level = result.level ?? rule.defaultConfiguration?.level ?? 'warning';
      if (!Number.isFinite(severity)) {
        throw new Error('Invalid CodeQL security severity.');
      }
      if (severity >= 4 || ['warning', 'error'].includes(level)) {
        failures.push({ rule: rule.id, severity, level });
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
    report.runs.flatMap((run) =>
      codeqlRuleComponents(run).flatMap((component) =>
        (component.rules ?? []).map((rule) => rule.id),
      ),
    ),
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
