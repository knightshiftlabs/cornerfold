const IMAGE_EXTENSIONS: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
}

/**
 * The kind of picture a file is, or '' if it is not one. A browser reports the type from what the system knows
 * about the file's ending, and sometimes reports nothing (Safari's engine does so for .webp, for one): a file with
 * no type, or the catch-all "application/octet-stream", is judged by its ending instead. A type the browser did
 * give always wins.
 */
export function imageType(f: { name: string; type: string }): string {
  if (f.type.startsWith('image/')) return f.type
  if (f.type !== '' && f.type !== 'application/octet-stream') return ''
  return IMAGE_EXTENSIONS[/\.([^.]+)$/.exec(f.name)?.[1].toLowerCase() ?? ''] ?? ''
}
