/**
 * languageDetection -- the server's single language detector.
 *
 * There used to be two. `ContentAnalyzer` detected with franc plus a CJK script
 * pre-check; `LocalizationManager.analyzeTextLanguage` was a stub whose own
 * comment said "In a real implementation, this could use a proper language
 * detection library" and which matched stop-word regexes for exactly five
 * languages. It reported Japanese as `null` (no pattern covers the script) and
 * French as `es` (both the `fr` and `es` lists match "de", "la", "en", "un",
 * "le", so whichever happened to match more tokens won), while analyze_content
 * answered the same three strings correctly.
 *
 * That split is the actual bug: the 2026-08-26 franc + CJK fix was applied to
 * ContentAnalyzer and never reached the localization path, so the same class of
 * failure shipped twice. Both callers now come through this module, so a fix
 * here reaches every surface and there is no second detector to drift.
 *
 * Codes are ISO 639-3 (what franc emits). `toIso6391()` converts for callers
 * that speak 639-1, which is what Accept-Language and html@lang use.
 */

import { franc, francAll } from 'franc';

/** Languages the detector will consider, ISO 639-3 -> English name. */
export const LANGUAGE_NAMES = {
  'eng': 'English',
  'spa': 'Spanish',
  'fra': 'French',
  'deu': 'German',
  'ita': 'Italian',
  'por': 'Portuguese',
  'rus': 'Russian',
  'jpn': 'Japanese',
  'kor': 'Korean',
  'cmn': 'Chinese',
  'arb': 'Arabic',
  'hin': 'Hindi',
  'nld': 'Dutch',
  'swe': 'Swedish',
  'nob': 'Norwegian',
  'dan': 'Danish',
  'fin': 'Finnish',
  'pol': 'Polish',
  'ces': 'Czech',
  'hun': 'Hungarian',
  'tur': 'Turkish',
  'ell': 'Greek',
  'heb': 'Hebrew',
  'tha': 'Thai',
  'vie': 'Vietnamese',
  'ind': 'Indonesian',
  'zlm': 'Malay',
  'zsm': 'Malay',
  'tgl': 'Tagalog',
  'ukr': 'Ukrainian',
  'bul': 'Bulgarian',
  'hrv': 'Croatian',
  'slv': 'Slovenian',
  'ron': 'Romanian',
  'lit': 'Lithuanian',
  'lav': 'Latvian',
  'est': 'Estonian',
  'slk': 'Slovak',
  'cat': 'Catalan',
  'eus': 'Basque',
  'glg': 'Galician',
  'gle': 'Irish',
  'cym': 'Welsh',
  'isl': 'Icelandic',
  'mlt': 'Maltese',
  'sqi': 'Albanian',
  'mkd': 'Macedonian',
  'srp': 'Serbian',
  'bos': 'Bosnian',
  'mon': 'Mongolian',
  'uzb': 'Uzbek',
  'kaz': 'Kazakh',
  'aze': 'Azerbaijani',
  'geo': 'Georgian',
  'arm': 'Armenian',
  'fas': 'Persian',
  'urd': 'Urdu',
  'ben': 'Bengali',
  'tam': 'Tamil',
  'tel': 'Telugu',
  'kan': 'Kannada',
  'mal': 'Malayalam',
  'guj': 'Gujarati',
  'pan': 'Punjabi',
  'ori': 'Odia',
  'mar': 'Marathi',
  'nep': 'Nepali',
  'sin': 'Sinhala',
  'mya': 'Burmese',
  'khm': 'Khmer',
  'lao': 'Lao',
  'amh': 'Amharic',
  'som': 'Somali',
  'swa': 'Swahili',
  'hau': 'Hausa',
  'yor': 'Yoruba',
  'ibo': 'Igbo',
  'afr': 'Afrikaans'
};

/**
 * ISO 639-3 -> ISO 639-1. Only codes with a 639-1 equivalent appear; the rest
 * have none, and callers keep the 639-3 code rather than invent one.
 */
export const ISO_639_3_TO_1 = {
  eng: 'en', spa: 'es', fra: 'fr', deu: 'de', ita: 'it', por: 'pt', rus: 'ru',
  jpn: 'ja', kor: 'ko', cmn: 'zh', arb: 'ar', hin: 'hi', nld: 'nl', swe: 'sv',
  nob: 'nb', dan: 'da', fin: 'fi', pol: 'pl', ces: 'cs', hun: 'hu', tur: 'tr',
  ell: 'el', heb: 'he', tha: 'th', vie: 'vi', ind: 'id', zlm: 'ms', zsm: 'ms',
  tgl: 'tl', ukr: 'uk', bul: 'bg', hrv: 'hr', slv: 'sl', ron: 'ro', lit: 'lt',
  lav: 'lv', est: 'et', slk: 'sk', cat: 'ca', eus: 'eu', glg: 'gl', gle: 'ga',
  cym: 'cy', isl: 'is', mlt: 'mt', sqi: 'sq', mkd: 'mk', srp: 'sr', bos: 'bs',
  mon: 'mn', uzb: 'uz', kaz: 'kk', aze: 'az', geo: 'ka', arm: 'hy', fas: 'fa',
  urd: 'ur', ben: 'bn', tam: 'ta', tel: 'te', kan: 'kn', mal: 'ml', guj: 'gu',
  pan: 'pa', ori: 'or', mar: 'mr', nep: 'ne', sin: 'si', mya: 'my', khm: 'km',
  lao: 'lo', amh: 'am', som: 'so', swa: 'sw', hau: 'ha', yor: 'yo', ibo: 'ig',
  afr: 'af'
};

/** The CJK share at or above which script alone settles the language. */
const CJK_SCRIPT_THRESHOLD = 0.1;

/**
 * Count CJK-script letters and their share of all letters. This is the script
 * signal detection uses; the ContentAnalyzer tokenizer reuses it to decide when
 * whitespace splitting cannot work.
 *
 * @param {string} text
 * @returns {{letters: number, han: number, kana: number, hangul: number, share: number}}
 */
export function cjkScriptCounts(text) {
  const letters = (text.match(/\p{L}/gu) || []).length;
  const han = (text.match(/\p{Script=Han}/gu) || []).length;
  const kana = (text.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu) || []).length;
  const hangul = (text.match(/\p{Script=Hangul}/gu) || []).length;
  return {
    letters,
    han,
    kana,
    hangul,
    share: letters > 0 ? (han + kana + hangul) / letters : 0
  };
}

/**
 * True when a meaningful share of the text is in a CJK script, i.e. words are
 * not whitespace-delimited and must be segmented by dictionary.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isCjkText(text) {
  return cjkScriptCounts(text).share >= CJK_SCRIPT_THRESHOLD;
}

/**
 * Detect the language of a piece of text.
 *
 * @param {string} text
 * @param {{minLength?: number}} [options]
 * @returns {{code: string, name: string, confidence: number,
 *            alternative: Array<{code: string, name: string, confidence: number}>,
 *            detectionMethod?: string} | null} null when undetermined
 */
export function detectLanguage(text, options = {}) {
  if (typeof text !== 'string' || text.trim() === '') return null;
  const minLength = options.minLength ?? 10;

  try {
    // franc scores the single most common script, so a Chinese, Japanese or
    // Korean page carrying the usual run of English product names and code
    // samples is detected as English. Those scripts never appear in
    // Latin-script prose, so a meaningful share of them settles the question
    // before trigram scoring gets a say.
    const { letters, han, kana, hangul, share } = cjkScriptCounts(text);
    if (letters > 0 && share >= CJK_SCRIPT_THRESHOLD) {
      const code = kana > 0 ? 'jpn' : hangul > han ? 'kor' : 'cmn';
      return {
        code,
        name: LANGUAGE_NAMES[code],
        confidence: 0.9,
        alternative: [],
        detectionMethod: 'script'
      };
    }

    const detected = franc(text, { minLength, whitelist: Object.keys(LANGUAGE_NAMES) });

    if (detected === 'und') {
      // Latin-script text franc could not place. Two English markers is a weak
      // signal, but it beats returning nothing for short English strings.
      const latinChars = (text.match(/[a-zA-Z]/g) || []).length;
      const totalChars = text.replace(/\s/g, '').length;
      if (totalChars > 0 && latinChars / totalChars > 0.7) {
        const lower = text.toLowerCase();
        const englishMarkers = ['the ', 'is ', 'are ', 'was ', 'and ', 'for ', 'that ', 'with ', 'this ', 'from '];
        if (englishMarkers.filter(w => lower.includes(w)).length >= 2) {
          return {
            code: 'eng',
            name: 'English',
            confidence: 0.6,
            alternative: [],
            detectionMethod: 'heuristic'
          };
        }
      }
      return null; // Truly undetermined language
    }

    const confidence = Math.min(1, 0.5 + (text.length / 500) * 0.5);

    // francAll scores are similarity relative to the winner (whose own score
    // is 1), while `confidence` above is length-based — two different scales.
    // Printed raw, a runner-up could read 0.82 against a winner shown at 0.8.
    // Scaling by the winner's confidence keeps the ranking and the invariant
    // that no alternative outranks the pick.
    const alternative = francAll(text, { minLength, whitelist: Object.keys(LANGUAGE_NAMES) })
      .slice(1, 4)
      .map(([code, score]) => ({
        code,
        name: LANGUAGE_NAMES[code] || code,
        confidence: Math.round(score * confidence * 100) / 100
      }));

    return {
      code: detected,
      name: LANGUAGE_NAMES[detected] || detected,
      confidence: Math.round(confidence * 100) / 100,
      alternative
    };
  } catch (error) {
    console.warn('Language detection failed:', error.message);
    return null;
  }
}

/**
 * The ISO 639-1 code for a 639-3 code, or the input unchanged when the language
 * has no 639-1 equivalent.
 *
 * @param {string|null|undefined} code
 * @returns {string|null}
 */
export function toIso6391(code) {
  if (!code) return null;
  return ISO_639_3_TO_1[code] || code;
}

export default detectLanguage;
