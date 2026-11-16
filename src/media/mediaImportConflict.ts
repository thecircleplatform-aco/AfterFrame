import { t } from '../i18n/locale';

/** Compare user-visible filenames, not paths, before a pool import. */
export function normalizeMediaName(name: string): string {
  return name.normalize('NFKC').trim().toLocaleLowerCase();
}

export function findMediaNameConflict<T extends { id: string; name: string }>(
  assets: ReadonlyArray<T>,
  incomingName: string,
): T | undefined {
  const normalized = normalizeMediaName(incomingName);
  return assets.find((asset) => normalizeMediaName(asset.name) === normalized);
}

/** User chose “” in the shared same-name import prompt. */
export class MediaImportCancelledError extends Error {
  constructor() {
    super(t('Upload cancelled — a file with that name already exists'));
    this.name = 'MediaImportCancelledError';
  }
}

export function isMediaImportCancelled(error: unknown): error is MediaImportCancelledError {
  return error instanceof MediaImportCancelledError;
}

/** Convert internal/server import failures into localized, user-facing status text. */
export function mediaImportErrorMessage(error: unknown): string {
  if (isMediaImportCancelled(error)) return t('Upload cancelled — a file with that name already exists');
  const message = error instanceof Error ? error.message : String(error ?? '');
  const partFailure = message.match(/part\s+(\d+)\s+failed\s*\((\d+)\)/i);
  if (partFailure) return t('Upload of part {part} failed ({status})', { part: partFailure[1]!, status: partFailure[2]! });
  if (/upload session not found or expired/i.test(message)) return t('The upload session expired; import again');
  if (/server returned no media path/i.test(message)) return t('The server did not return a save path; try again');
  if (/failed to fetch|networkerror|network request failed|load failed/i.test(message)) {
    return t('Network connection failed; check your connection and try again');
  }
  const compatibilityDetail = message.match(/^Video compatibility processing failed: (.+)$/u)?.[1]?.trim();
  if ((compatibilityDetail && !/[\u3400-\u9fff]/u.test(compatibilityDetail))
    || /video compatibility (?:check|processing) failed|media normalization failed|\bffmpeg\b|\bffprobe\b|timed out after/i.test(message)) {
    return t('Video compatibility processing failed; try again');
  }
  const httpFailure = message.match(/\bHTTP\s+(\d{3})\b/i);
  if (httpFailure) return t('Media request failed ({status})', { status: httpFailure[1]! });
  if (/[\u3400-\u9fff]/u.test(message)) return message;
  return t('Media import failed; try again');
}
