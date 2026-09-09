// ==========================================================================
// WeatherGPT — i18n
// Minimal, honest localization: only strings actually translated below are
// switched. Structured as flat key → {en, hi, mr} so more languages/keys
// can be added without touching call sites.
// ==========================================================================

export const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'हिंदी (Hindi)' },
];

const DICT = {
  nav_ask: { en: 'Ask', hi: 'पूछें' },
  nav_warnings: { en: 'Warnings', hi: 'चेतावनी' },
  nav_climate: { en: 'Climate Trends', hi: 'जलवायु रुझान' },
  nav_about: { en: 'About the Data', hi: 'डेटा के बारे में' },

  hero_eyebrow: { en: 'Conversational Weather Intelligence', hi: 'संवादात्मक मौसम जानकारी' },
  hero_title: { en: 'Ask the weather anything.', hi: 'मौसम से कुछ भी पूछें।' },
  hero_sub: {
    en: 'WeatherGPT brings forecasts, warnings, and climate data together into a single, source-attributed answer for your location — never a guess.',
    hi: 'WeatherGPT आपके स्थान के लिए पूर्वानुमान, चेतावनी और जलवायु डेटा को एक स्रोत-सहित उत्तर में जोड़ता है — कभी अनुमान नहीं।',
  },
  hero_cta_primary: { en: 'Ask a question', hi: 'सवाल पूछें' },
  hero_cta_secondary: { en: 'See how answers are verified', hi: 'उत्तर कैसे सत्यापित होते हैं देखें' },

  station_label: { en: 'The Query Station', hi: 'क्वेरी स्टेशन' },
  station_hint: {
    en: 'Type a plain-language question, or use the controls below — both drive the same live data.',
    hi: 'सामान्य भाषा में सवाल टाइप करें, या नीचे नियंत्रणों का उपयोग करें — दोनों एक ही लाइव डेटा का उपयोग करते हैं।',
  },
  tab_ask: { en: 'Ask WeatherGPT', hi: 'WeatherGPT से पूछें' },
  tab_controls: { en: 'Structured controls', hi: 'संरचित नियंत्रण' },
  chat_placeholder: { en: 'Will it rain in Raipur tomorrow evening?', hi: 'क्या रायपुर में कल शाम बारिश होगी?' },
  ask_button: { en: 'Ask WeatherGPT', hi: 'पूछें' },

  loc_label: { en: 'Location', hi: 'स्थान' },
  time_label: { en: 'Time range', hi: 'समय सीमा' },
  variable_label: { en: 'Variable', hi: 'विषय' },
  role_label: { en: 'Role', hi: 'भूमिका' },

  why_toggle: { en: 'Why?', hi: 'क्यों?' },
  no_warning: { en: 'No active warnings for', hi: 'के लिए कोई सक्रिय चेतावनी नहीं' },
  connectivity_offline: {
    en: "You're offline — showing cached data where available.",
    hi: 'आप ऑफ़लाइन हैं — जहाँ उपलब्ध हो वहाँ कैश्ड डेटा दिखाया जा रहा है।',
  },
  notify_toggle_label: {
    en: 'Notify me in-browser if risk rises for this location',
    hi: 'यदि इस स्थान के लिए जोखिम बढ़ता है तो मुझे ब्राउज़र में सूचित करें',
  },
};

export function t(key, lang) {
  const entry = DICT[key];
  if (!entry) return key;
  return entry[lang] || entry.en;
}

/** Apply translations to every element with [data-i18n] in the given root. */
export function applyTranslations(root, lang) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key, lang);
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    el.setAttribute('placeholder', t(key, lang));
  });
}
