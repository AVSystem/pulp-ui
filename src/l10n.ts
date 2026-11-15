import { i18n } from '@lingui/core';
import {
  readStored,
  removeStored,
  writeStored,
} from 'src/utilities/safe-storage';

// remember to update lingui.config.js as well
export const availableLanguages = ['en', 'es', 'fr', 'ko', 'nl', 'ja', 'zh'];
export const languageNames = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  ko: '한국어',
  nl: 'Nederlands',
  ja: '日本語',
  zh: '中文',
};

async function activate(locale: string, pseudolocalization = false) {
  const { messages } = await import(`src/../locale/${locale}.js`);

  if (pseudolocalization) {
    Object.keys(messages).forEach((key) => {
      if (Array.isArray(messages[key])) {
        // t`Foo ${param}` -> ["Foo ", ['param']] => [">>", "Foo ", ['param'], "<<"]
        messages[key] = ['»', ...messages[key], '«'];
      } else {
        // simple string
        messages[key] = '»' + messages[key] + '«';
      }
    });
  }

  i18n.load(locale, messages);
  i18n.activate(locale);
}

// Accept-Language
const userLanguage = navigator.languages
  .map((lang) => lang.replace(/[-_].*/, ''))
  .filter((lang) => availableLanguages.includes(lang))[0];

const searchParams = Object.fromEntries(
  new URLSearchParams(window.location.search),
);

if (searchParams.pseudolocalization === 'true') {
  writeStored('test_l10n', 'true');
}
if (searchParams.pseudolocalization === 'false') {
  removeStored('test_l10n');
}

if (searchParams.lang) {
  writeStored('override_l10n', searchParams.lang);
}
if (searchParams.lang === '') {
  removeStored('override_l10n');
}

// ?lang and ?pseudolocalization get removed in entrypoint.tsx
// (removed to prevent the param getting passed to api calls)
// (in entrypoint.tsx to prevent interaction with pushState)

const storedLanguage = readStored('override_l10n');
const overrideLanguage =
  storedLanguage && availableLanguages.includes(storedLanguage)
    ? storedLanguage
    : null;
export const language = overrideLanguage || userLanguage || 'en';
const pseudolocalization = readStored('test_l10n') === 'true';

if (overrideLanguage) {
  console.debug(
    `language autodetection overriden to: ${overrideLanguage}, unset by visiting ${
      window.location.origin + window.location.pathname + '?lang='
    }`,
  );
}
if (pseudolocalization) {
  console.debug(
    `pseudolocalization enabled, unset by visiting ${
      window.location.origin +
      window.location.pathname +
      '?pseudolocalization=false'
    }`,
  );
}

activate(language, pseudolocalization);
