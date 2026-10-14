import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Builders and fixture consumers share one location, independent of shell cwd.
export function reviewOutputDirectory(environment = process.env) {
  return resolve(root, environment.CASHWEAVE_REVIEW_OUTPUT_DIR || 'review-output');
}

export function reviewArtifactUrl(name, environment = process.env) {
  if (!name || basename(name) !== name || name.includes('\\') || name === '.' || name === '..') {
    throw new Error('Review artifact must be a single filename');
  }
  return pathToFileURL(resolve(reviewOutputDirectory(environment), name));
}
