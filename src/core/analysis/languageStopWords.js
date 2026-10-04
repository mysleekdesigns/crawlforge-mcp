/**
 * Stop words applied only when the text is detected as that language, keyed by
 * the ISO 639-3 code languageDetection.js returns. German keywords came back as
 * "die, ist, und, der, ein, für, das" (R24); every other detected language got
 * its articles and prepositions back the same way. They are kept out of
 * ContentAnalyzer's STOP_WORDS because several are English content words —
 * "war", "hat", "die", "man", "son" — that an English article must still be
 * able to rank.
 *
 * Only languages written with spaces between words are listed: the others are
 * segmented by script, and their function words are handled there. Words that
 * double as common nouns ("estado", "stato") are left out. The REST
 * analyze_content route in crawlforge-website keeps the same lists, keyed by
 * ISO 639-1.
 */

const SPANISH = [
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'del', 'al', 'de', 'en', 'con', 'por',
  'para', 'sin', 'sobre', 'entre', 'hasta', 'desde', 'hacia', 'según', 'durante', 'tras', 'contra',
  'ante', 'bajo', 'que', 'como', 'cuando', 'donde', 'quien', 'quienes', 'cual', 'cuales', 'cuyo',
  'porque', 'pero', 'sino', 'aunque', 'pues', 'mientras', 'también', 'tampoco', 'muy', 'más',
  'menos', 'tan', 'tanto', 'ya', 'aún', 'todavía', 'solo', 'sólo', 'así', 'aquí', 'allí', 'ahí',
  'ahora', 'siempre', 'nunca', 'nada', 'algo', 'alguien', 'nadie', 'todo', 'toda', 'todos',
  'todas', 'otro', 'otra', 'otros', 'otras', 'mismo', 'misma', 'mismos', 'mismas', 'cada',
  'mucho', 'mucha', 'muchos', 'muchas', 'poco', 'pocos', 'este', 'esta', 'estos', 'estas', 'esto',
  'ese', 'esa', 'esos', 'esas', 'eso', 'aquel', 'aquella', 'aquellos', 'aquellas', 'ella',
  'ellos', 'ellas', 'nosotros', 'nosotras', 'vosotros', 'usted', 'ustedes', 'les', 'nos', 'sus',
  'suyo', 'suya', 'nuestro', 'nuestra', 'nuestros', 'nuestras', 'mis', 'tus', 'ser', 'es', 'son',
  'era', 'eran', 'fue', 'fueron', 'sido', 'sea', 'sean', 'será', 'serán', 'estar', 'está',
  'están', 'estaba', 'estaban', 'haber', 'ha', 'han', 'había', 'habían', 'hay', 'hubo', 'habrá',
  'tener', 'tiene', 'tienen', 'tenía', 'puede', 'pueden', 'podría', 'hacer', 'hace', 'hacen',
  'uno', 'dos', 'tres', 'qué', 'cómo', 'dónde', 'cuándo', 'se', 'lo', 'le', 'me', 'te', 'mi',
  'tu', 'su', 'ni', 'no', 'sí'
];

const FRENCH = [
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'au', 'aux', 'et', 'ou', 'mais', 'donc',
  'car', 'ni', 'que', 'qui', 'quoi', 'dont', 'où', 'quand', 'comme', 'si', 'ce', 'cet', 'cette',
  'ces', 'celui', 'celle', 'ceux', 'celles', 'cela', 'ceci', 'ça', 'son', 'sa', 'ses', 'leur',
  'leurs', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'notre', 'nos', 'votre', 'vos', 'il', 'elle',
  'ils', 'elles', 'nous', 'vous', 'je', 'tu', 'on', 'lui', 'eux', 'moi', 'toi', 'se', 'en',
  'dans', 'sur', 'sous', 'avec', 'sans', 'pour', 'par', 'chez', 'vers', 'entre', 'depuis',
  'pendant', 'avant', 'après', 'contre', 'selon', 'parmi', 'est', 'sont', 'était', 'étaient',
  'été', 'être', 'sera', 'seront', 'soit', 'fut', 'ont', 'avait', 'avaient', 'avoir', 'aura',
  'peut', 'peuvent', 'faire', 'pas', 'plus', 'moins', 'très', 'aussi', 'encore', 'déjà',
  'toujours', 'jamais', 'bien', 'tout', 'tous', 'toute', 'toutes', 'autre', 'autres', 'même',
  'mêmes', 'chaque', 'quelque', 'quelques', 'plusieurs', 'ainsi', 'alors', 'puis', 'ici', 'non',
  'oui', 'ne', 'deux', 'trois'
];

const ITALIAN = [
  'il', 'lo', 'la', 'gli', 'le', 'un', 'uno', 'una', 'di', 'del', 'dello', 'della', 'dei', 'degli',
  'delle', 'al', 'allo', 'alla', 'ai', 'agli', 'alle', 'da', 'dal', 'dallo', 'dalla', 'dai',
  'dagli', 'dalle', 'in', 'nel', 'nello', 'nella', 'nei', 'negli', 'nelle', 'con', 'col', 'su',
  'sul', 'sullo', 'sulla', 'sui', 'sugli', 'sulle', 'per', 'tra', 'fra', 'ed', 'ma', 'però',
  'anche', 'come', 'che', 'chi', 'cui', 'quale', 'quali', 'quando', 'dove', 'perché', 'se', 'non',
  'più', 'meno', 'molto', 'molti', 'molta', 'molte', 'poco', 'tutto', 'tutti', 'tutta', 'tutte',
  'ogni', 'altro', 'altri', 'altra', 'altre', 'stesso', 'stessa', 'questo', 'questa', 'questi',
  'queste', 'quello', 'quella', 'quelli', 'quelle', 'suo', 'sua', 'suoi', 'sue', 'loro', 'mio',
  'mia', 'miei', 'mie', 'tuo', 'tua', 'nostro', 'nostra', 'nostri', 'vostro', 'lui', 'lei', 'noi',
  'voi', 'essi', 'esse', 'io', 'tu', 'egli', 'ella', 'si', 'ci', 'vi', 'ne', 'mi', 'ti', 'è',
  'sono', 'era', 'erano', 'fu', 'furono', 'essere', 'sia', 'sarà', 'ha', 'hanno', 'aveva',
  'avevano', 'avere', 'avuto', 'può', 'possono', 'fare', 'fa', 'già', 'ancora', 'sempre', 'mai',
  'così', 'qui', 'poi', 'dopo', 'prima', 'senza', 'sotto', 'sopra', 'verso', 'contro', 'due',
  'tre', 'circa'
];

const PORTUGUESE = [
  'os', 'as', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos',
  'nas', 'ao', 'aos', 'às', 'por', 'pelo', 'pela', 'pelos', 'pelas', 'para', 'com', 'sem', 'sobre',
  'entre', 'até', 'desde', 'contra', 'após', 'ou', 'mas', 'porém', 'que', 'quem', 'qual', 'quais',
  'cujo', 'como', 'quando', 'onde', 'porque', 'se', 'não', 'sim', 'mais', 'menos', 'muito',
  'muita', 'muitos', 'muitas', 'pouco', 'todo', 'toda', 'todos', 'todas', 'outro', 'outra',
  'outros', 'outras', 'mesmo', 'mesma', 'cada', 'este', 'esta', 'estes', 'estas', 'isto', 'esse',
  'essa', 'esses', 'essas', 'isso', 'aquele', 'aquela', 'aqueles', 'aquelas', 'aquilo', 'seu',
  'sua', 'seus', 'suas', 'meu', 'minha', 'meus', 'minhas', 'nosso', 'nossa', 'nossos', 'nossas',
  'ele', 'ela', 'eles', 'elas', 'eu', 'você', 'vocês', 'nós', 'lhe', 'lhes', 'me', 'te', 'é',
  'são', 'era', 'eram', 'foi', 'foram', 'ser', 'sido', 'seja', 'será', 'está', 'estão', 'estava',
  'estar', 'tem', 'têm', 'tinha', 'ter', 'há', 'havia', 'pode', 'podem', 'fazer', 'faz', 'já',
  'ainda', 'também', 'sempre', 'nunca', 'aqui', 'ali', 'lá', 'então', 'assim', 'dois', 'duas',
  'três'
];

const DUTCH = [
  'de', 'het', 'een', 'en', 'of', 'maar', 'want', 'dus', 'dat', 'die', 'dit', 'deze', 'wat', 'wie',
  'waar', 'wanneer', 'hoe', 'waarom', 'als', 'dan', 'omdat', 'hoewel', 'in', 'op', 'aan', 'met',
  'van', 'voor', 'door', 'naar', 'bij', 'uit', 'over', 'onder', 'tussen', 'tot', 'om', 'te',
  'tegen', 'zonder', 'sinds', 'na', 'is', 'zijn', 'was', 'waren', 'ben', 'bent', 'wordt',
  'worden', 'werd', 'werden', 'geweest', 'heeft', 'hebben', 'had', 'hadden', 'kan', 'kunnen',
  'kon', 'zal', 'zullen', 'zou', 'zouden', 'moet', 'moeten', 'wil', 'willen', 'niet', 'geen',
  'ook', 'nog', 'al', 'wel', 'zeer', 'heel', 'meer', 'veel', 'weinig', 'alle', 'alles', 'elke',
  'ieder', 'iets', 'niets', 'hier', 'daar', 'er', 'nu', 'toen', 'zo', 'hij', 'zij', 'ze', 'wij',
  'we', 'jij', 'je', 'ik', 'hem', 'haar', 'hun', 'ons', 'onze', 'jullie', 'mijn', 'zich', 'men',
  'andere', 'twee', 'drie', 'toch', 'echter'
];

const SWEDISH = [
  'och', 'att', 'det', 'som', 'en', 'ett', 'den', 'de', 'är', 'var', 'för', 'med', 'till', 'av',
  'på', 'om', 'från', 'vid', 'under', 'över', 'efter', 'mot', 'utan', 'genom', 'mellan', 'hos',
  'inte', 'har', 'hade', 'kan', 'kunde', 'ska', 'skulle', 'vill', 'måste', 'blir', 'blev',
  'varit', 'vara', 'bli', 'han', 'hon', 'hen', 'vi', 'ni', 'jag', 'du', 'dem', 'honom', 'henne',
  'oss', 'sin', 'sitt', 'sina', 'hans', 'hennes', 'deras', 'vår', 'våra', 'min', 'mitt', 'mina',
  'din', 'denna', 'detta', 'dessa', 'där', 'här', 'när', 'hur', 'vad', 'vem', 'vilken',
  'vilket', 'vilka', 'men', 'eller', 'också', 'även', 'bara', 'mycket', 'mer', 'mest', 'alla',
  'allt', 'andra', 'annan', 'sedan', 'nu', 'då', 'så', 'redan', 'två', 'tre', 'än', 'sig', 'man',
  'dock'
];

const DANISH = [
  'og', 'at', 'det', 'som', 'en', 'et', 'den', 'de', 'er', 'var', 'for', 'med', 'til', 'af', 'på',
  'om', 'fra', 'ved', 'under', 'over', 'efter', 'mod', 'uden', 'gennem', 'mellem', 'hos', 'ikke',
  'har', 'havde', 'kan', 'kunne', 'skal', 'skulle', 'vil', 'ville', 'må', 'bliver', 'blev',
  'været', 'være', 'blive', 'han', 'hun', 'vi', 'jeg', 'du', 'dem', 'ham', 'hende', 'os', 'sin',
  'sit', 'sine', 'hans', 'hendes', 'deres', 'vores', 'min', 'mit', 'mine', 'din', 'denne',
  'dette', 'disse', 'der', 'her', 'når', 'hvor', 'hvordan', 'hvad', 'hvem', 'hvilken', 'hvilket',
  'hvilke', 'men', 'eller', 'også', 'kun', 'meget', 'mere', 'mest', 'alle', 'alt', 'andre',
  'anden', 'andet', 'siden', 'nu', 'da', 'så', 'allerede', 'to', 'tre', 'end', 'sig', 'man', 'dog'
];

const NORWEGIAN = [
  'og', 'at', 'det', 'som', 'en', 'et', 'ei', 'den', 'de', 'er', 'var', 'for', 'med', 'til', 'av',
  'på', 'om', 'fra', 'ved', 'under', 'over', 'etter', 'mot', 'uten', 'gjennom', 'mellom', 'hos',
  'ikke', 'har', 'hadde', 'kan', 'kunne', 'skal', 'skulle', 'vil', 'ville', 'må', 'blir', 'ble',
  'vært', 'være', 'bli', 'han', 'hun', 'vi', 'jeg', 'du', 'dem', 'ham', 'henne', 'oss', 'sin',
  'sitt', 'sine', 'hans', 'hennes', 'deres', 'vår', 'våre', 'min', 'mitt', 'mine', 'din', 'denne',
  'dette', 'disse', 'der', 'her', 'når', 'hvor', 'hvordan', 'hva', 'hvem', 'hvilken', 'hvilket',
  'hvilke', 'men', 'eller', 'også', 'bare', 'meget', 'mye', 'mer', 'mest', 'alle', 'alt', 'andre',
  'annen', 'annet', 'siden', 'nå', 'da', 'så', 'allerede', 'to', 'tre', 'enn', 'seg', 'man', 'dog'
];

const POLISH = [
  'we', 'ze', 'na', 'do', 'od', 'po', 'za', 'przez', 'przy', 'pod', 'nad', 'przed', 'bez', 'dla',
  'oraz', 'lub', 'albo', 'ale', 'lecz', 'czy', 'że', 'który', 'która', 'które', 'którego',
  'której', 'których', 'którzy', 'jak', 'gdy', 'kiedy', 'gdzie', 'jest', 'są', 'był', 'była',
  'było', 'byli', 'były', 'być', 'będzie', 'będą', 'ma', 'mają', 'miał', 'może', 'można', 'nie',
  'tak', 'też', 'także', 'już', 'jeszcze', 'tylko', 'bardzo', 'więcej', 'się', 'to', 'ten', 'ta',
  'te', 'tego', 'tej', 'tym', 'tych', 'ich', 'jego', 'jej', 'on', 'ona', 'ono', 'oni', 'one', 'my',
  'wy', 'ja', 'ty', 'nas', 'was', 'mu', 'go', 'jako', 'tam', 'tu', 'teraz', 'wszystko',
  'wszyscy', 'inne', 'inny', 'swój', 'swoja', 'swoje', 'swoją', 'swojej', 'swojego', 'swoich',
  'swoim', 'jednak', 'ponieważ', 'dwa', 'trzy', 'co'
];

// Indonesian and Malay share most of their function words; the spellings
// that differ ("karena"/"kerana", "bahwa"/"bahawa") are both listed.
const INDONESIAN_MALAY = [
  'yang', 'dan', 'di', 'ke', 'dari', 'dalam', 'untuk', 'pada', 'dengan', 'oleh', 'atau', 'tetapi',
  'tapi', 'juga', 'ini', 'itu', 'adalah', 'ialah', 'akan', 'telah', 'sudah', 'belum', 'tidak',
  'tak', 'bukan', 'ada', 'sebagai', 'karena', 'kerana', 'bahwa', 'bahawa', 'jika', 'kalau', 'saat',
  'ketika', 'apabila', 'seperti', 'lebih', 'sangat', 'hanya', 'masih', 'dapat', 'boleh', 'bisa',
  'harus', 'mereka', 'kami', 'kita', 'saya', 'anda', 'dia', 'ia', 'beliau', 'nya', 'para',
  'sebuah', 'seorang', 'setiap', 'semua', 'banyak', 'antara', 'hingga', 'sehingga', 'sejak',
  'tentang', 'terhadap', 'tersebut', 'agar', 'supaya', 'namun', 'maka', 'pun', 'lagi', 'satu',
  'dua', 'tiga', 'yaitu', 'iaitu', 'serta', 'bagi', 'kepada', 'daripada'
];

const GERMAN = [
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einer', 'eines', 'einem', 'einen',
  'und', 'oder', 'aber', 'doch', 'sondern', 'denn', 'weil', 'dass', 'daß', 'wenn', 'als', 'wie',
  'ob', 'ist', 'sind', 'war', 'waren', 'wird', 'werden', 'wurde', 'wurden', 'worden', 'sein',
  'seine', 'seinen', 'seiner', 'seinem', 'seines', 'ihre', 'ihren', 'ihrer', 'ihrem', 'ihr',
  'hat', 'haben', 'hatte', 'hatten', 'habe', 'kann', 'können', 'konnte', 'muss', 'müssen',
  'soll', 'sollen', 'will', 'wollen', 'mit', 'von', 'vom', 'zum', 'zur', 'bei', 'beim', 'aus',
  'nach', 'auf', 'für', 'über', 'unter', 'vor', 'durch', 'gegen', 'ohne', 'um', 'bis', 'seit',
  'zwischen', 'auch', 'nur', 'noch', 'schon', 'sehr', 'mehr', 'nicht', 'kein', 'keine', 'keinen',
  'sich', 'sie', 'ich', 'du', 'er', 'es', 'wir', 'ihn', 'ihm', 'uns', 'euch', 'man', 'mich',
  'dir', 'mir', 'dich', 'dies', 'diese', 'dieser', 'dieses', 'diesem', 'diesen', 'jede',
  'jeder', 'jedes', 'alle', 'allen', 'aller', 'alles', 'damit', 'dann', 'da', 'hier', 'dort',
  'so', 'im', 'ins', 'am', 'an', 'in', 'zu', 'was', 'wer', 'wo', 'etwa', 'immer',
  'bereits', 'sowie', 'zwei', 'drei', 'viele', 'einige', 'andere', 'anderen', 'unser', 'unsere'
];

const indonesianMalay = new Set(INDONESIAN_MALAY);

export const LANGUAGE_STOP_WORDS = {
  deu: new Set(GERMAN),
  spa: new Set(SPANISH),
  fra: new Set(FRENCH),
  ita: new Set(ITALIAN),
  por: new Set(PORTUGUESE),
  nld: new Set(DUTCH),
  swe: new Set(SWEDISH),
  dan: new Set(DANISH),
  nob: new Set(NORWEGIAN),
  pol: new Set(POLISH),
  ind: indonesianMalay,
  zlm: indonesianMalay,
  zsm: indonesianMalay
};

export default LANGUAGE_STOP_WORDS;
