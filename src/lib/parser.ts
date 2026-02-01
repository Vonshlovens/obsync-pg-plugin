import { parse as parseYaml } from 'yaml';

// Regex patterns matching the Go version
const frontmatterRegex = /^---\n([\s\S]+?)\n---\n?/;
const wikiLinkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
const inlineTagRegex = /(?:^|[^&\w])#([a-zA-Z][a-zA-Z0-9_/-]*)/g;
const codeBlockRegex = /```[\s\S]*?```/g;
const inlineCodeRegex = /`[^`]+`/g;

// Common date formats used in Obsidian
const dateFormats = [
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/, // ISO 8601
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/,
  /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/,
  /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,
  /^\d{4}-\d{2}-\d{2}$/,
];

export interface Frontmatter {
  title: string | null;
  tags: string[];
  aliases: string[];
  created: Date | null;
  modified: Date | null;
  publish: boolean | null;
  extra: Record<string, unknown>;
}

export interface ParsedNote {
  frontmatter: Frontmatter;
  body: string;
  rawContent: string;
  outgoingLinks: string[];
  inlineTags: string[];
}

/**
 * Parse a flexible date string into a Date object
 */
function parseFlexibleDate(value: unknown): Date | null {
  if (!value) return null;

  if (value instanceof Date) return value;

  if (typeof value === 'string') {
    const str = value.trim();
    if (!str) return null;

    // Try parsing with Date constructor
    const date = new Date(str);
    if (!isNaN(date.getTime())) {
      return date;
    }
  }

  if (typeof value === 'number') {
    return new Date(value);
  }

  return null;
}

/**
 * Normalize string or array to string array
 */
function normalizeStringArray(value: unknown): string[] {
  if (!value) return [];

  if (typeof value === 'string') {
    return value ? [value] : [];
  }

  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }

  return [];
}

/**
 * Parse YAML frontmatter from content
 */
export function parseFrontmatter(content: string): { frontmatter: Frontmatter; body: string } {
  const fm: Frontmatter = {
    title: null,
    tags: [],
    aliases: [],
    created: null,
    modified: null,
    publish: null,
    extra: {},
  };

  const match = content.match(frontmatterRegex);
  if (!match) {
    return { frontmatter: fm, body: content };
  }

  const yamlContent = match[1];
  const body = content.slice(match[0].length);

  try {
    const parsed = parseYaml(yamlContent) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') {
      return { frontmatter: fm, body };
    }

    // Extract known fields
    if (typeof parsed.title === 'string') {
      fm.title = parsed.title;
    }

    fm.tags = normalizeStringArray(parsed.tags);
    fm.aliases = normalizeStringArray(parsed.aliases);
    fm.created = parseFlexibleDate(parsed.created);
    fm.modified = parseFlexibleDate(parsed.modified);

    if (typeof parsed.publish === 'boolean') {
      fm.publish = parsed.publish;
    }

    // Store extra fields
    const knownFields = new Set(['title', 'tags', 'aliases', 'created', 'modified', 'publish']);
    for (const [key, value] of Object.entries(parsed)) {
      if (!knownFields.has(key)) {
        fm.extra[key] = value;
      }
    }
  } catch {
    // If YAML parsing fails, return empty frontmatter
    return { frontmatter: fm, body: content };
  }

  return { frontmatter: fm, body };
}

/**
 * Extract wiki links from content
 */
export function extractWikiLinks(content: string): string[] {
  const seen = new Set<string>();
  const links: string[] = [];

  let match;
  while ((match = wikiLinkRegex.exec(content)) !== null) {
    let link = match[1].trim();

    // Handle anchors: [[folder/page#heading]] -> folder/page
    const hashIndex = link.indexOf('#');
    if (hashIndex !== -1) {
      link = link.slice(0, hashIndex).trim();
    }

    if (link && !seen.has(link)) {
      seen.add(link);
      links.push(link);
    }
  }

  return links;
}

/**
 * Extract inline tags from content (excluding code blocks)
 */
export function extractInlineTags(content: string): string[] {
  // Remove code blocks to avoid matching tags in code
  let cleanContent = content.replace(codeBlockRegex, '');
  cleanContent = cleanContent.replace(inlineCodeRegex, '');

  const seen = new Set<string>();
  const tags: string[] = [];

  let match;
  while ((match = inlineTagRegex.exec(cleanContent)) !== null) {
    const tag = match[1].toLowerCase().trim();
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  }

  return tags;
}

/**
 * Merge frontmatter tags and inline tags, removing duplicates
 */
export function mergeTags(frontmatterTags: string[], inlineTags: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const tag of frontmatterTags) {
    const normalized = tag.toLowerCase().trim();
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      merged.push(normalized);
    }
  }

  for (const tag of inlineTags) {
    const normalized = tag.toLowerCase().trim();
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      merged.push(normalized);
    }
  }

  return merged;
}

/**
 * Parse a markdown file content
 */
export function parseContent(content: string, filename: string): ParsedNote {
  const { frontmatter, body } = parseFrontmatter(content);

  // Use filename as title if not in frontmatter
  if (!frontmatter.title) {
    frontmatter.title = filename.replace(/\.md$/, '');
  }

  const outgoingLinks = extractWikiLinks(body);
  const inlineTags = extractInlineTags(body);

  return {
    frontmatter,
    body,
    rawContent: content,
    outgoingLinks,
    inlineTags,
  };
}
