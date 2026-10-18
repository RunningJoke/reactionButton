import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import de from "./de.json";

const STORAGE_KEY = "reactpod.language";

export const LANGUAGES = ["en", "de"] as const;
export type Language = (typeof LANGUAGES)[number];

// English is the primary language and the fallback for missing keys.
export const resources = {
  en: { translation: en },
  de: { translation: de },
} as const;

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "en",
    supportedLngs: [...LANGUAGES],
    nonExplicitSupportedLngs: true,
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: STORAGE_KEY,
      caches: [], // written by setLanguage only, so "System" stays possible
    },
  });

/** Sets the UI language. `null` = follow the browser language. */
export function setLanguage(language: Language | null) {
  try {
    if (language === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // storage may be unavailable (private mode); the choice then lasts for this session only
  }
  const next = language ?? i18n.services.languageDetector?.detect?.() ?? "en";
  void i18n.changeLanguage(Array.isArray(next) ? next[0] : next);
}

export function storedLanguage(): Language | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return (LANGUAGES as readonly string[]).includes(value ?? "") ? (value as Language) : null;
  } catch {
    return null;
  }
}

export default i18n;
