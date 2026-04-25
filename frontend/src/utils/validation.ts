import type { ValidationError } from "../api";

export function isMissingError(err: ValidationError): boolean {
  if (err.message == null) return false;
  return /Missing child element|required but missing/i.test(err.message);
}

export function extractMissingName(err: ValidationError): string | null {
  if (err.message == null) return null;
  const childMatch = err.message.match(/Expected is \(\s*([^\s)]+)\s*\)/);
  if (childMatch) return childMatch[1];
  const attrMatch = err.message.match(/attribute '([^']+)' is required but missing/i);
  if (attrMatch) return `@${attrMatch[1]}`;
  return null;
}
