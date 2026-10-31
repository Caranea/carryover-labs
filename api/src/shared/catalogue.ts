/**
 * The tests Carryover recognises without a model call. Each test has one key
 * across labs and languages ("Płytki krwi", "PLT", "Thrombozyten", "Platelet
 * Count" → platelets), the unit it is usually printed in, and conservative
 * verification bounds that prompt a human source check; never a medical judgment.
 *
 * Aliases are written normalised (see `normaliseName`): lowercase, no
 * diacritics, punctuation as spaces, "%" and "#" kept.
 */

export type Domain =
  | 'blood-count'
  | 'white-cells'
  | 'platelets'
  | 'thyroid'
  | 'metabolic'
  | 'kidney'
  | 'electrolytes'
  | 'liver'
  | 'lipids'
  | 'iron'
  | 'inflammation'
  | 'coagulation'
  | 'autoimmune'
  | 'vitamins'
  | 'serology'
  | 'other';

export const DOMAINS: { key: Domain; label: string }[] = [
  { key: 'blood-count', label: 'Red blood cells' },
  { key: 'white-cells', label: 'White blood cells' },
  { key: 'platelets', label: 'Platelets' },
  { key: 'thyroid', label: 'Thyroid' },
  { key: 'metabolic', label: 'Glucose' },
  { key: 'kidney', label: 'Kidneys' },
  { key: 'electrolytes', label: 'Electrolytes' },
  { key: 'liver', label: 'Liver' },
  { key: 'lipids', label: 'Lipids' },
  { key: 'iron', label: 'Iron' },
  { key: 'inflammation', label: 'Inflammation' },
  { key: 'coagulation', label: 'Clotting' },
  { key: 'autoimmune', label: 'Immune and autoimmune' },
  { key: 'vitamins', label: 'Vitamins' },
  { key: 'serology', label: 'Infection tests' },
  { key: 'other', label: 'Other tests' },
];

export interface CatalogueTest {
  key: string;
  label: string;
  domain: Domain;
  /** The unit this test is usually printed in; plausible limits are in this unit. */
  unit: string;
  aliases: string[];
  /** g/mol, for mass ↔ molar conversion. */
  molarMass?: number;
  /** Outside these verification bounds, ask the user to check the source. Not clinical reference ranges. */
  plausible?: [number, number];
  /** Tests in the same group may share a chart (same unit and scale permitting); others get their own. */
  group?: string;
}

const t = (
  key: string,
  label: string,
  domain: Domain,
  unit: string,
  aliases: string[],
  extra: Partial<Pick<CatalogueTest, 'molarMass' | 'plausible' | 'group'>> = {},
): CatalogueTest => ({ key, label, domain, unit, aliases, ...extra });

export const CATALOGUE: CatalogueTest[] = [
  // Red cells
  t(
    'rbc',
    'Red blood cells',
    'blood-count',
    '10^12/L',
    [
      'erytrocyty',
      'erytrocyty rbc',
      'rbc',
      'red cell count',
      'red blood cells',
      'red blood cell count',
      'erythrozyten',
      'erythrocytes',
      'krwinki czerwone',
    ],
    { plausible: [0.5, 10] },
  ),
  t(
    'hgb',
    'Haemoglobin',
    'blood-count',
    'g/dL',
    [
      'hemoglobina',
      'hemoglobina hgb',
      'haemoglobin',
      'hemoglobin',
      'hamoglobin',
      'hb',
      'hgb',
      'hb i vb kb',
    ],
    { molarMass: 16114.5, plausible: [2, 25] },
  ),
  t(
    'hct',
    'Haematocrit',
    'blood-count',
    '%',
    [
      'hematokryt',
      'hematokryt hct',
      'haematocrit',
      'hematocrit',
      'hamatokrit',
      'hct',
      'pcv',
      'pcv hamatokrit',
    ],
    { plausible: [8, 75] },
  ),
  t('mcv', 'MCV', 'blood-count', 'fL', ['mcv', 'mean cell volume', 'mean corpuscular volume'], {
    plausible: [40, 160],
  }),
  t(
    'mch',
    'MCH',
    'blood-count',
    'pg',
    ['mch', 'mean cell haemoglobin', 'mean corpuscular hemoglobin'],
    { plausible: [10, 60] },
  ),
  t('mchc', 'MCHC', 'blood-count', 'g/dL', ['mchc'], { plausible: [20, 45] }),
  t('rdw-cv', 'RDW-CV', 'blood-count', '%', ['rdw cv', 'rdw', 'rdw cv%'], { plausible: [5, 40] }),
  t('rdw-sd', 'RDW-SD', 'blood-count', 'fL', ['rdw sd'], { plausible: [20, 120] }),
  t(
    'retic-pct',
    'Reticulocytes %',
    'blood-count',
    '%',
    ['retikulocyty', 'retikulocyty %', 'reticulocytes', 'retikulozyten', 'ret'],
    { plausible: [0, 40] },
  ),
  t(
    'retic',
    'Reticulocytes',
    'blood-count',
    '10^12/L',
    ['retikulocyty #', 'retikulocyty il', 'reticulocytes #', 'ret #'],
    { plausible: [0, 1] },
  ),
  t('lfr', 'LFR (low fluorescence reticulocytes)', 'blood-count', '%', ['lfr'], {
    plausible: [0, 100],
    group: 'retic-fractions',
  }),
  t('mfr', 'MFR (medium fluorescence reticulocytes)', 'blood-count', '%', ['mfr'], {
    plausible: [0, 100],
    group: 'retic-fractions',
  }),
  t('hfr', 'HFR (high fluorescence reticulocytes)', 'blood-count', '%', ['hfr'], {
    plausible: [0, 100],
    group: 'retic-fractions',
  }),
  t('irf', 'IRF (immature reticulocyte fraction)', 'blood-count', '%', ['irf'], {
    plausible: [0, 100],
    group: 'retic-fractions',
  }),
  t('nrbc', 'Nucleated red cells', 'blood-count', '10^9/L', ['nrbc #', 'nrbc'], {
    plausible: [0, 50],
  }),
  t('nrbc-pct', 'Nucleated red cells %', 'blood-count', '%', ['nrbc %'], { plausible: [0, 100] }),

  // White cells
  t(
    'wbc',
    'White blood cells',
    'white-cells',
    '10^9/L',
    [
      'leukocyty',
      'leukocyty wbc',
      'wbc',
      'white cell count',
      'white blood cells',
      'white blood cell count',
      'leukozyten',
      'leukozyten i vb',
      'leukocytes',
      'wcc',
      'krwinki biale',
    ],
    { plausible: [0.1, 500], group: 'wbc-count' },
  ),
  t(
    'neut',
    'Neutrophils',
    'white-cells',
    '10^9/L',
    [
      'neutrofile',
      'neutrofile #',
      'neutrophils',
      'neutrophils #',
      'neutrophile',
      'neutrophile granulozyten',
      'neu',
      'neu #',
    ],
    { plausible: [0, 300], group: 'wbc-count' },
  ),
  t(
    'neut-pct',
    'Neutrophils %',
    'white-cells',
    '%',
    [
      'neutrofile %',
      'neutrophils %',
      'neu %',
      'gran segmentowane',
      'granulocyty obojetnochlonne',
      'segmentkernige',
    ],
    { plausible: [0, 100], group: 'wbc-pct' },
  ),
  t(
    'lymph',
    'Lymphocytes',
    'white-cells',
    '10^9/L',
    ['limfocyty', 'limfocyty #', 'lymphocytes', 'lymphocytes #', 'lymphozyten', 'lym', 'lym #'],
    { plausible: [0, 300], group: 'wbc-count' },
  ),
  t('lymph-pct', 'Lymphocytes %', 'white-cells', '%', ['limfocyty %', 'lymphocytes %', 'lym %'], {
    plausible: [0, 100],
    group: 'wbc-pct',
  }),
  t(
    'mono',
    'Monocytes',
    'white-cells',
    '10^9/L',
    ['monocyty', 'monocyty #', 'monocytes', 'monocytes #', 'monozyten', 'mon', 'mon #'],
    { plausible: [0, 50], group: 'wbc-count' },
  ),
  t('mono-pct', 'Monocytes %', 'white-cells', '%', ['monocyty %', 'monocytes %', 'mon %'], {
    plausible: [0, 100],
    group: 'wbc-pct',
  }),
  t(
    'eos',
    'Eosinophils',
    'white-cells',
    '10^9/L',
    ['eozynofile', 'eozynofile #', 'eosinophils', 'eosinophils #', 'eosinophile', 'eos', 'eos #'],
    { plausible: [0, 50], group: 'wbc-count' },
  ),
  t(
    'eos-pct',
    'Eosinophils %',
    'white-cells',
    '%',
    ['eozynofile %', 'eosinophils %', 'eos %', 'gran kwasochlonne', 'eosinophils 1%'],
    { plausible: [0, 100], group: 'wbc-pct' },
  ),
  t(
    'baso',
    'Basophils',
    'white-cells',
    '10^9/L',
    ['bazofile', 'bazofile #', 'basophils', 'basophils #', 'basophile', 'bas', 'baso', 'bas #'],
    { plausible: [0, 20], group: 'wbc-count' },
  ),
  t(
    'baso-pct',
    'Basophils %',
    'white-cells',
    '%',
    ['bazofile %', 'basophils %', 'bas %', 'gran zasadochlonne'],
    { plausible: [0, 100], group: 'wbc-pct' },
  ),
  t(
    'ig',
    'Immature granulocytes',
    'white-cells',
    '10^9/L',
    [
      'niedojrzale granulocyty ig il',
      'niedojrzale granulocyty ig #',
      'niedojrzale granulocyty ig',
      'immature granulocytes',
      'ig #',
    ],
    { plausible: [0, 50], group: 'wbc-count' },
  ),
  t(
    'ig-pct',
    'Immature granulocytes %',
    'white-cells',
    '%',
    ['niedojrzale granulocyty ig %', 'immature granulocytes %', 'ig %'],
    { plausible: [0, 100], group: 'wbc-pct' },
  ),
  t(
    'mxd',
    'Mixed cells (eos, baso, mono)',
    'white-cells',
    '10^9/L',
    ['inne eo bazo mono #', 'inne eo bazo mono', 'mxd', 'mxd #', 'mid', 'mid #'],
    { plausible: [0, 50], group: 'wbc-count' },
  ),
  t('mxd-pct', 'Mixed cells %', 'white-cells', '%', ['inne eo bazo mono %', 'mxd %', 'mid %'], {
    plausible: [0, 100],
    group: 'wbc-pct',
  }),
  t(
    'atyp-lymph',
    'Atypical lymphocytes',
    'white-cells',
    '10^9/L',
    ['atypowe limfocyty', 'atypowe limfocyty #', 'atypical lymphocytes'],
    { plausible: [0, 50], group: 'wbc-count' },
  ),
  t(
    'atyp-lymph-pct',
    'Atypical lymphocytes %',
    'white-cells',
    '%',
    ['atypowe limfocyty %', 'atypical lymphocytes %'],
    { plausible: [0, 100], group: 'wbc-pct' },
  ),
  t(
    'luc',
    'Large immature cells',
    'white-cells',
    '10^9/L',
    ['niedojrzale duze komorki', 'niedojrzale duze komorki mlode formy', 'luc'],
    { plausible: [0, 50], group: 'wbc-count' },
  ),
  t(
    'luc-pct',
    'Large immature cells %',
    'white-cells',
    '%',
    ['niedojrzale duze komorki %', 'niedojrzale duze komorki mlode formy %', 'luc %'],
    { plausible: [0, 100], group: 'wbc-pct' },
  ),

  // Platelets
  t(
    'plt',
    'Platelets',
    'platelets',
    '10^9/L',
    [
      'plytki krwi',
      'plytki krwi plt',
      'plytki krwi manualnie',
      'plt',
      'platelets',
      'platelet count',
      'thrombozyten',
      'trombocyty',
      'platelets tt',
    ],
    { plausible: [1, 2500] },
  ),
  t('mpv', 'MPV', 'platelets', 'fL', ['mpv', 'mpv i vb', 'mean platelet volume'], {
    plausible: [4, 20],
    group: 'platelet-volume',
  }),
  t('pdw', 'PDW', 'platelets', 'fL', ['pdw', 'thrombozytenverteilungsbreite'], {
    plausible: [4, 30],
    group: 'platelet-volume',
  }),
  t('p-lcr', 'P-LCR', 'platelets', '%', ['p lcr', 'plcr'], { plausible: [1, 80] }),
  t('pct', 'Plateletcrit', 'platelets', '%', ['pct', 'plateletcrit'], { plausible: [0, 2] }),

  // Thyroid
  t(
    'tsh',
    'TSH',
    'thyroid',
    'mIU/L',
    ['tsh', 'tsh 3 generacji', 'tsh basal', 'thyrotropin', 'thyroid stimulating hormone'],
    { plausible: [0, 500] },
  ),
  t(
    'ft4',
    'Free T4',
    'thyroid',
    'ng/dL',
    ['ft4', 'free t4', 'ft4 wolna tyroksyna', 'wolna tyroksyna', 'freies t4', 'ft 4'],
    { molarMass: 776.87, plausible: [0.05, 15] },
  ),
  t(
    'ft3',
    'Free T3',
    'thyroid',
    'pg/mL',
    ['ft3', 'free t3', 'wolna trijodotyronina', 'freies t3', 'ft 3'],
    { molarMass: 650.97, plausible: [0.3, 40] },
  ),
  t(
    'anti-tpo',
    'Anti-TPO',
    'thyroid',
    'IU/mL',
    [
      'anty tpo',
      'anti tpo',
      'atpo',
      'tpo ak',
      'tpo antikorper',
      'przeciwciala anty tpo',
      'thyroid peroxidase antibodies',
    ],
    { plausible: [0, 100000], group: 'thyroid-antibodies' },
  ),
  t(
    'anti-tg',
    'Anti-TG',
    'thyroid',
    'IU/mL',
    ['anty tg', 'anti tg', 'atg', 'tg ak', 'przeciwciala anty tg', 'thyroglobulin antibodies'],
    { plausible: [0, 100000], group: 'thyroid-antibodies' },
  ),
  t(
    'trab',
    'TRAb',
    'thyroid',
    'IU/L',
    [
      'trab',
      'p c p receptorom tsh trab',
      'p c p receptorom tsh trab wynik',
      'przeciwciala przeciw receptorom tsh',
      'trak',
    ],
    { plausible: [0, 1000] },
  ),

  // Glucose
  t(
    'glucose',
    'Glucose',
    'metabolic',
    'mg/dL',
    [
      'glukoza',
      'glukoza na czczo',
      'glucose',
      'glukose',
      'glucose i p',
      'blutzucker',
      'fasting glucose',
    ],
    { molarMass: 180.16, plausible: [10, 1500] },
  ),
  t('hba1c', 'HbA1c', 'metabolic', '%', ['hba1c', 'hemoglobina glikowana', 'glykohamoglobin'], {
    plausible: [2, 20],
  }),

  // Kidneys
  t(
    'creatinine',
    'Creatinine',
    'kidney',
    'mg/dL',
    ['kreatynina', 'creatinine', 'creatinin', 'creatinin i p', 'kreatinin'],
    { molarMass: 113.12, plausible: [0.05, 25] },
  ),
  t('egfr', 'eGFR', 'kidney', 'ml/min/1.73m²', ['egfr', 'gfr', 'egfr ckd epi', 'egfr mdrd'], {
    plausible: [1, 200],
  }),
  t('urea', 'Urea', 'kidney', 'mg/dL', ['mocznik', 'urea', 'harnstoff'], {
    molarMass: 60.06,
    plausible: [1, 600],
  }),
  t(
    'uric-acid',
    'Uric acid',
    'kidney',
    'mg/dL',
    ['kwas moczowy', 'uric acid', 'urate', 'harnsaure'],
    { molarMass: 168.11, plausible: [0.2, 30] },
  ),

  // Electrolytes
  t('sodium', 'Sodium', 'electrolytes', 'mmol/L', ['sod', 'sodium', 'natrium', 'na', 'sod na'], {
    plausible: [90, 200],
    group: 'electrolytes',
  }),
  t(
    'potassium',
    'Potassium',
    'electrolytes',
    'mmol/L',
    ['potas', 'potassium', 'kalium', 'k', 'potas k'],
    { plausible: [1, 10], group: 'electrolytes' },
  ),
  t('chloride', 'Chloride', 'electrolytes', 'mmol/L', ['chlorki', 'chloride', 'chlorid', 'cl'], {
    plausible: [60, 150],
    group: 'electrolytes',
  }),
  t(
    'calcium',
    'Calcium',
    'electrolytes',
    'mmol/L',
    ['wapn', 'wapn calkowity', 'calcium', 'kalzium', 'ca'],
    { molarMass: 40.08, plausible: [0.5, 5], group: 'electrolytes' },
  ),
  t('magnesium', 'Magnesium', 'electrolytes', 'mmol/L', ['magnez', 'magnesium', 'mg'], {
    molarMass: 24.305,
    plausible: [0.1, 5],
    group: 'electrolytes',
  }),
  t(
    'phosphate',
    'Phosphate',
    'electrolytes',
    'mmol/L',
    ['fosfor', 'fosforany', 'phosphate', 'phosphat', 'phosphorus'],
    { molarMass: 30.97, plausible: [0.1, 6], group: 'electrolytes' },
  ),

  // Liver
  t(
    'alt',
    'ALT',
    'liver',
    'U/L',
    ['alt', 'alat', 'gpt', 'alt alat', 'aminotransferaza alaninowa', 'alanine aminotransferase'],
    { plausible: [0, 10000], group: 'liver-enzymes' },
  ),
  t(
    'ast',
    'AST',
    'liver',
    'U/L',
    [
      'ast',
      'aspat',
      'got',
      'ast aspat',
      'aminotransferaza asparaginianowa',
      'aspartate aminotransferase',
    ],
    { plausible: [0, 10000], group: 'liver-enzymes' },
  ),
  t('ggt', 'GGT', 'liver', 'U/L', ['ggtp', 'ggt', 'gamma gt', 'gamma glutamylotranspeptydaza'], {
    plausible: [0, 5000],
    group: 'liver-enzymes',
  }),
  t(
    'alp',
    'Alkaline phosphatase',
    'liver',
    'U/L',
    ['fosfataza alkaliczna', 'alp', 'ap', 'alkalische phosphatase', 'alkaline phosphatase'],
    { plausible: [0, 5000], group: 'liver-enzymes' },
  ),
  t(
    'bilirubin',
    'Bilirubin',
    'liver',
    'mg/dL',
    [
      'bilirubina',
      'bilirubina calkowita',
      'bilirubin',
      'bilirubin gesamt',
      'bilirubin gesamt i p',
      'total bilirubin',
    ],
    { molarMass: 584.66, plausible: [0, 50] },
  ),
  t('albumin', 'Albumin', 'liver', 'g/dL', ['albumina', 'albumin', 'albumine'], {
    plausible: [0.5, 7],
  }),
  t(
    'total-protein',
    'Total protein',
    'liver',
    'g/dL',
    ['bialko calkowite', 'total protein', 'gesamteiweiss', 'protein gesamt'],
    { plausible: [2, 15] },
  ),

  // Lipids
  t(
    'chol',
    'Total cholesterol',
    'lipids',
    'mg/dL',
    [
      'cholesterol calkowity',
      'cholesterol',
      'cholesterin',
      'total cholesterol',
      'gesamtcholesterin',
    ],
    { molarMass: 386.65, plausible: [30, 1000], group: 'lipids' },
  ),
  t(
    'hdl',
    'HDL cholesterol',
    'lipids',
    'mg/dL',
    ['cholesterol hdl', 'hdl cholesterol', 'hdl', 'hdl cholesterin'],
    { molarMass: 386.65, plausible: [5, 200], group: 'lipids' },
  ),
  t(
    'ldl',
    'LDL cholesterol',
    'lipids',
    'mg/dL',
    ['cholesterol ldl', 'ldl cholesterol', 'ldl', 'ldl cholesterin'],
    { molarMass: 386.65, plausible: [5, 600], group: 'lipids' },
  ),
  t(
    'tg',
    'Triglycerides',
    'lipids',
    'mg/dL',
    ['triglicerydy', 'triglycerides', 'triglyceride', 'tg'],
    { molarMass: 885.7, plausible: [10, 10000], group: 'lipids' },
  ),

  // Iron
  t('iron', 'Iron', 'iron', 'µg/dL', ['zelazo', 'iron', 'eisen', 'fe'], {
    molarMass: 55.845,
    plausible: [5, 1000],
  }),
  t('ferritin', 'Ferritin', 'iron', 'ng/mL', ['ferrytyna', 'ferritin'], {
    plausible: [0.5, 100000],
  }),
  t('transferrin', 'Transferrin', 'iron', 'g/L', ['transferyna', 'transferrin'], {
    plausible: [0.2, 10],
  }),
  t('tibc', 'TIBC', 'iron', 'µg/dL', ['tibc', 'calkowita zdolnosc wiazania zelaza'], {
    molarMass: 55.845,
    plausible: [50, 1000],
  }),

  // Inflammation
  t(
    'crp',
    'CRP',
    'inflammation',
    'mg/L',
    ['crp', 'bialko c reaktywne', 'c reactive protein', 'c reaktives protein', 'hs crp'],
    { plausible: [0, 600] },
  ),
  t(
    'esr',
    'ESR',
    'inflammation',
    'mm/h',
    ['ob', 'esr', 'bsg', 'odczyn biernackiego', 'erythrocyte sedimentation rate'],
    { plausible: [0, 200] },
  ),

  // Clotting
  t('inr', 'INR', 'coagulation', 'ratio', ['inr'], { plausible: [0.3, 15] }),
  t(
    'pt',
    'Prothrombin time',
    'coagulation',
    's',
    ['czas protrombinowy', 'pt', 'prothrombin time', 'thromboplastinzeit'],
    { plausible: [5, 200], group: 'clotting-times' },
  ),
  t(
    'quick',
    'Prothrombin index',
    'coagulation',
    '%',
    ['wskaznik protrombiny', 'wskaznik protombiny', 'quick', 'quick wert'],
    { plausible: [1, 200] },
  ),
  t('aptt', 'APTT', 'coagulation', 's', ['aptt', 'czas kaolinowo kefalinowy', 'ptt'], {
    plausible: [5, 300],
    group: 'clotting-times',
  }),
  t('fibrinogen', 'Fibrinogen', 'coagulation', 'mg/dL', ['fibrynogen', 'fibrinogen'], {
    plausible: [10, 2000],
  }),
  t('d-dimer', 'D-dimer', 'coagulation', 'ng/mL', ['d dimery', 'd dimer', 'd dimere'], {
    plausible: [0, 100000],
  }),

  // Immune and autoimmune
  t(
    'ana',
    'Antinuclear antibodies (titre)',
    'autoimmune',
    'titre',
    [
      'antinuclear antibody titre hep 2',
      'antinuclear antibody titre',
      'ana',
      'ana titre',
      'ana hep 2',
      'przeciwciala przeciwjadrowe',
      'ana1',
    ],
    { plausible: [0, 100000] },
  ),
  t(
    'dsdna',
    'Anti-dsDNA',
    'autoimmune',
    'IU/mL',
    ['anti dsdna', 'dsdna', 'ds dna antibodies', 'anty dsdna', 'dna ab', 'dsdna ab'],
    { plausible: [0, 10000] },
  ),
  t(
    'c3',
    'Complement C3',
    'autoimmune',
    'g/L',
    ['c3', 'c3 complement', 'complement c3', 'skladowa c3'],
    { plausible: [0.05, 5], group: 'complement' },
  ),
  t(
    'c4',
    'Complement C4',
    'autoimmune',
    'g/L',
    ['c4', 'c4 complement', 'complement c4', 'skladowa c4'],
    { plausible: [0.005, 2], group: 'complement' },
  ),
  t(
    'rf',
    'Rheumatoid factor',
    'autoimmune',
    'IU/mL',
    ['czynnik reumatoidalny', 'rf', 'rheumatoid factor', 'rheumafaktor'],
    { plausible: [0, 10000] },
  ),
  t('ccp', 'Anti-CCP', 'autoimmune', 'U/mL', ['anty ccp', 'anti ccp', 'ccp', 'ccp ab'], {
    plausible: [0, 10000],
  }),
  t(
    'ttg-iga',
    'Anti-tTG IgA',
    'autoimmune',
    'U/mL',
    [
      'tissue transglutaminase iga abs',
      'ttg iga',
      'anti ttg iga',
      'przeciwciala przeciw transglutaminazie tkankowej iga',
    ],
    { plausible: [0, 10000] },
  ),
  t(
    'dgp-igg',
    'Deamidated gliadin IgG',
    'autoimmune',
    'U/mL',
    ['gliadin deamidated igg abs', 'si gliadin deamidated igg abs', 'dgp igg', 'gliadin igg'],
    { plausible: [0, 10000] },
  ),
  t(
    'iga',
    'Immunoglobulin A',
    'autoimmune',
    'g/L',
    ['immunoglobulin a total iga', 'iga', 'immunoglobulina a', 'iga total'],
    { plausible: [0, 20], group: 'immunoglobulins' },
  ),
  t(
    'igg',
    'Immunoglobulin G',
    'autoimmune',
    'g/L',
    ['immunoglobulin g', 'igg', 'immunoglobulina g'],
    { plausible: [0.5, 60], group: 'immunoglobulins' },
  ),
  t(
    'igm',
    'Immunoglobulin M',
    'autoimmune',
    'g/L',
    ['immunoglobulin m', 'igm', 'immunoglobulina m'],
    { plausible: [0, 30], group: 'immunoglobulins' },
  ),

  // Vitamins
  t(
    'b12',
    'Vitamin B12',
    'vitamins',
    'pg/mL',
    ['witamina b12', 'vitamin b12', 'serum vitamin b12 assay', 'b12', 'cobalamin'],
    { molarMass: 1355.37, plausible: [20, 20000] },
  ),
  t(
    'folate',
    'Folate',
    'vitamins',
    'ng/mL',
    ['kwas foliowy', 'folate', 'folsaure', 'serum folate', 'serum folate assay'],
    { molarMass: 441.4, plausible: [0.2, 100] },
  ),
  t(
    'rbc-folate',
    'Red cell folate',
    'vitamins',
    'nmol/L',
    ['red cell folate assay', 'red cell folate', 'erythrocyte folate'],
    { molarMass: 441.4, plausible: [50, 10000] },
  ),
  t(
    'vit-d',
    'Vitamin D (25-OH)',
    'vitamins',
    'ng/mL',
    [
      'witamina d',
      'witamina d3 25 oh',
      '25 oh witamina d',
      'vitamin d',
      '25 oh vitamin d',
      '25 oh d',
    ],
    { molarMass: 400.64, plausible: [1, 250] },
  ),

  // Infection tests (usually qualitative)
  t(
    'anti-hcv',
    'Anti-HCV',
    'serology',
    'ratio',
    [
      'przeciwciala anty hcv',
      'anti hcv',
      'hcv ab',
      'wirus zapalenia watroby typ c przeciwciala anty hcv',
    ],
    {},
  ),
  t('hbsag', 'HBsAg', 'serology', 'ratio', ['hbsag', 'antygen hbs'], {}),
];

export const BY_KEY = new Map(CATALOGUE.map((test) => [test.key, test]));
