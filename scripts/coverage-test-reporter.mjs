/** A successful release run cannot hide skipped, TODO, or undiscovered tests. */
export default async function* coverageTestReporter(events) {
  let complete = false;
  for await (const event of events) {
    if (event.type !== 'test:summary' || event.data.file !== undefined) {
      continue;
    }
    complete = true;
    const { counts, success } = event.data;
    yield `${JSON.stringify({ ...counts, success })}\n`;
    if (!success || counts.tests === 0 || counts.skipped > 0 || counts.todo > 0) {
      throw new Error('Release coverage requires passing tests with no skips or TODOs.');
    }
  }
  if (!complete) {
    throw new Error('The test runner did not produce a complete test summary.');
  }
}
