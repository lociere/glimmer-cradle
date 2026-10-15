import GithubSlugger from 'github-slugger';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { toString } from 'mdast-util-to-string';

export function markdownInfo(text) {
  // YAML metadata is not a rendered heading; keep offsets stable for callers.
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, value => value.replace(/[^\r\n]/g, ' '));
  const tree = fromMarkdown(body);
  const slugger = new GithubSlugger();
  const headings = new Set();
  const links = [];
  function visit(node) {
    if (node.type === 'heading') headings.add(slugger.slug(toString(node, { includeHtml: false })));
    if (['link', 'image', 'definition'].includes(node.type)) links.push(node.url);
    for (const child of node.children ?? []) visit(child);
  }
  visit(tree);
  return { headings, links: links.filter(target => target && !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) };
}
