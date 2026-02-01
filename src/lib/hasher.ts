import { createHash } from 'crypto';

/**
 * Compute SHA256 hash of content
 */
export function hashContent(content: string | Buffer): string {
  const hash = createHash('sha256');
  hash.update(content);
  return hash.digest('hex');
}

/**
 * Compute SHA256 hash of an ArrayBuffer
 */
export function hashArrayBuffer(buffer: ArrayBuffer): string {
  const hash = createHash('sha256');
  hash.update(Buffer.from(buffer));
  return hash.digest('hex');
}
