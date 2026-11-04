/** Public source identity; no environment values other than a commit hash escape here. */
export function releaseRevision(environment: NodeJS.ProcessEnv = process.env): string | null {
  const values = [
    environment.RENDER_GIT_COMMIT,
    environment.GITHUB_SHA,
    environment.CAREIQ_BUILD_REVISION,
  ].filter((value): value is string => value !== undefined);
  if (values.some((value) => !/^[a-f0-9]{40}$/.test(value)) || new Set(values).size > 1) {
    throw new Error('Release revision must be one consistent full Git commit SHA.');
  }
  if (!values.length && environment.NODE_ENV === 'production') {
    throw new Error('Production requires a verified build revision.');
  }
  return values[0] ?? null;
}
