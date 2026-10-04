/**
 * Stop words beyond German (R24 Phase 3 follow-up).
 *
 * Phase 3.8 gave German its own stop words; every other detected language
 * still got its function words back as keywords and topics — Spanish
 * "del, más, una", French "pour, est, sont", Dutch "van, het, zijn",
 * Indonesian "dan, ini, yang". Each language the detector returns that is
 * written with spaces now has a list (src/core/analysis/languageStopWords.js),
 * applied only when the text is detected as that language.
 *
 * Run: node --test --test-force-exit tests/unit/languageStopWords.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AnalyzeContentTool } from '../../src/tools/extract/analyzeContent.js';
import { SummarizeContentTool } from '../../src/tools/extract/summarizeContent.js';
import { LANGUAGE_STOP_WORDS } from '../../src/core/analysis/languageStopWords.js';
import { LANGUAGE_NAMES } from '../../src/utils/languageDetection.js';

// code: [paragraph, function words that ranked as keywords before, content words that must stay]
const CASES = {
  spa: [
    'Madrid es la capital de España y la ciudad más poblada del país. La ciudad tiene una historia muy rica y es conocida por sus museos, como el Museo del Prado. Cada año, millones de turistas visitan la ciudad para disfrutar de su cultura y de su gastronomía. Los parques de Madrid son grandes y están llenos de vida durante todo el año.',
    ['del', 'más', 'una', 'tiene', 'los', 'para', 'están'], ['ciudad', 'madrid']
  ],
  fra: [
    'Paris est la capitale de la France et la ville la plus peuplée du pays. La ville est connue pour ses musées, comme le Louvre, et pour la tour Eiffel. Chaque année, des millions de touristes visitent la ville pour découvrir son histoire et sa cuisine. Les parcs de Paris sont très beaux et ils sont pleins de vie pendant toute l’année.',
    ['pour', 'est', 'sont', 'plus', 'ses', 'les', 'des'], ['ville', 'paris']
  ],
  ita: [
    'Roma è la capitale dell’Italia e la città più popolosa del paese. La città è famosa per i suoi monumenti, come il Colosseo, e per la sua storia antica. Ogni anno milioni di turisti visitano la città per scoprire la cultura e la cucina italiana. I parchi di Roma sono molto belli e sono pieni di vita durante tutto l’anno.',
    ['per', 'sono', 'più', 'del', 'suoi', 'come', 'molto'], ['città', 'roma']
  ],
  por: [
    'Lisboa é a capital de Portugal e a cidade mais populosa do país. A cidade é conhecida pelos seus monumentos, como a Torre de Belém, e pela sua história. Todos os anos milhões de turistas visitam a cidade para conhecer a cultura e a gastronomia portuguesa. Os parques de Lisboa são muito bonitos e estão cheios de vida durante todo o ano.',
    ['mais', 'pelos', 'seus', 'como', 'pela', 'para', 'são'], ['cidade', 'lisboa']
  ],
  nld: [
    'Amsterdam is de hoofdstad van Nederland en de grootste stad van het land. De stad is bekend om haar grachten, musea en de vele fietsen. Elk jaar komen miljoenen toeristen naar de stad om de cultuur en de geschiedenis te ontdekken. De parken van Amsterdam zijn erg mooi en ze zijn het hele jaar door vol met mensen.',
    ['van', 'het', 'zijn', 'haar', 'naar', 'door', 'met'], ['stad', 'amsterdam']
  ],
  swe: [
    'Stockholm är Sveriges huvudstad och landets största stad. Staden är byggd på fjorton öar och är känd för sina museer och sin vackra arkitektur. Varje år kommer miljontals turister till staden för att upptäcka dess kultur och historia. Parkerna i Stockholm är mycket vackra och de är fulla av människor under hela sommaren.',
    ['och', 'för', 'sina', 'till', 'att', 'mycket'], ['stockholm', 'staden']
  ],
  dan: [
    'København er Danmarks hovedstad og landets største by. Byen er kendt for sine kanaler, sine museer og den lille havfrue. Hvert år kommer millioner af turister til byen for at opleve dens kultur og historie. Parkerne i København er meget smukke, og de er fulde af mennesker hele sommeren.',
    ['sine', 'den', 'for', 'til', 'meget'], ['københavn', 'byen']
  ],
  nob: [
    'Oslo er Norges hovedstad og landets største by. Byen ligger ved enden av Oslofjorden og er kjent for sine museer og sin moderne arkitektur. Hvert år kommer millioner av turister til byen for å oppleve kulturen og historien. Parkene i Oslo er veldig vakre, og de er fulle av mennesker hele sommeren.',
    ['ved', 'sine', 'sin', 'for', 'til'], ['oslo', 'byen']
  ],
  pol: [
    'Warszawa jest stolicą Polski i największym miastem w kraju. Miasto jest znane ze swojej historii, która była bardzo trudna, oraz z odbudowanego Starego Miasta. Każdego roku miliony turystów odwiedzają miasto, aby poznać jego kulturę i historię. Parki w Warszawie są bardzo piękne i są pełne ludzi przez całe lato.',
    ['jest', 'bardzo', 'swojej', 'która', 'była', 'oraz', 'przez'], ['miasto', 'warszawa']
  ],
  ind: [
    'Jakarta adalah ibu kota Indonesia dan kota terbesar di negara tersebut. Kota ini dikenal dengan kemacetan lalu lintas yang sangat padat dan gedung-gedung tinggi. Setiap tahun, jutaan orang datang ke kota ini untuk bekerja dan mencari kehidupan yang lebih baik. Taman-taman di Jakarta tidak banyak, tetapi mereka selalu penuh dengan orang pada akhir pekan.',
    ['dan', 'ini', 'dengan', 'yang', 'adalah', 'untuk', 'tidak'], ['kota', 'jakarta']
  ]
};

describe('function words are not keywords or topics outside English and German', () => {
  for (const [code, [text, functionWords, contentWords]] of Object.entries(CASES)) {
    test(`${LANGUAGE_NAMES[code]} (${code})`, async () => {
      const analysis = await new AnalyzeContentTool().execute({ text });
      assert.equal(analysis.language.code, code, 'the paragraph is detected as the language under test');
      const keywords = analysis.keywords.map((k) => k.keyword);
      const topics = analysis.topics.map((t) => t.topic);
      const summaryKeywords = (await new SummarizeContentTool().execute({ text })).keywords.map((k) => k.keyword);

      for (const [label, list] of [['keywords', keywords], ['topics', topics], ['summarize keywords', summaryKeywords]]) {
        for (const fw of functionWords) assert.ok(!list.includes(fw), `${label} contain "${fw}": ${list}`);
        for (const word of list) assert.ok(!LANGUAGE_STOP_WORDS[code].has(word), `${label} contain stop word "${word}"`);
        for (const cw of contentWords) assert.ok(list.includes(cw), `${label} lost "${cw}": ${list}`);
      }
    });
  }
});

describe('stop-word lists', () => {
  test('every list is keyed by a code the detector can return', () => {
    for (const code of Object.keys(LANGUAGE_STOP_WORDS)) assert.ok(LANGUAGE_NAMES[code], code);
  });

  test('Malay shares the Indonesian list', () => {
    assert.ok(LANGUAGE_STOP_WORDS.zsm.has('kerana') && LANGUAGE_STOP_WORDS.ind.has('karena'));
    assert.equal(LANGUAGE_STOP_WORDS.zsm, LANGUAGE_STOP_WORDS.ind);
  });

  test('the lists stay scoped: Spanish and French words still rank in English', async () => {
    const english = 'The son of the king was born in the palace. The son grew up to become a soldier. The son later ruled the kingdom for forty years.';
    const r = await new AnalyzeContentTool().execute({ text: english });
    assert.ok(r.keywords.some((k) => /\bson\b/.test(k.keyword)), r.keywords.map((k) => k.keyword).join(','));
  });
});
