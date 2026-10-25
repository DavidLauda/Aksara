export const LANGUAGE_SETTINGS_KEY = 'languageSettings';
export const SOURCE_LANGUAGES = [
  { code: 'eng_Latn', ocr: 'eng', label: 'English' },
  { code: 'ind_Latn', ocr: 'ind', label: 'Indonesian' },
] as const;
export const TARGET_LANGUAGES = [
  { code: 'ind_Latn', label: 'Indonesian' },
  { code: 'eng_Latn', label: 'English' },
  { code: 'fra_Latn', label: 'French' },
] as const;
export type SourceLanguage = typeof SOURCE_LANGUAGES[number]['code'];
export type TargetLanguage = typeof TARGET_LANGUAGES[number]['code'];
export type LanguageSettings = { sourceLanguage: SourceLanguage; targetLanguage: TargetLanguage };
export const DEFAULT_LANGUAGES: Readonly<LanguageSettings> = Object.freeze({ sourceLanguage: 'eng_Latn', targetLanguage: 'ind_Latn' });

/** Repair stored preferences field by field. Only bundled OCR packs are accepted. */
export function languageSettings(value: unknown): LanguageSettings {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    sourceLanguage: SOURCE_LANGUAGES.some(language => language.code === record.sourceLanguage) ? record.sourceLanguage as SourceLanguage : DEFAULT_LANGUAGES.sourceLanguage,
    targetLanguage: TARGET_LANGUAGES.some(language => language.code === record.targetLanguage) ? record.targetLanguage as TargetLanguage : DEFAULT_LANGUAGES.targetLanguage,
  };
}
export function ocrLanguage(source: SourceLanguage) {
  return SOURCE_LANGUAGES.find(language => language.code === source)!.ocr;
}
