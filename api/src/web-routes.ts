import { extname } from 'node:path';

/**
 * Whether a path is a page of the Angular app, answered with index.html. A path with a file
 * extension is a file: when it's missing it must stay a 404. After a new build, a tab still open
 * asks for the old chunks, and index.html in their place fails as a wrongly typed module.
 */
export function isAppPage(path: string): boolean {
  return !path.startsWith('/api/') && extname(path) === '';
}

/** GET and HEAD share an answer: link checkers and uptime monitors ask with HEAD. */
export function servesAppPage(method: string, path: string): boolean {
  return (method === 'GET' || method === 'HEAD') && isAppPage(path);
}
