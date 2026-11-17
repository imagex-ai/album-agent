/** Video folders are filesystem names; gallery folders are logical labels. */
export function validVideoDestination(value: string | null | undefined): boolean {
  if (!value || value.length > 120 || value !== value.trim() || /^[._]|[._]$/.test(value) || /[<>:"/\\|?*\x00-\x1f]/.test(value) || /\s{2,}/.test(value)) return false;
  return !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(value);
}
export function validGalleryDestination(value: string | null | undefined): boolean {
  return Boolean(value && value === value.trim() && value.length <= 150 && !/[\x00-\x1f]/.test(value));
}
