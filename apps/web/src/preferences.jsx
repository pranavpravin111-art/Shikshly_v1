import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { request } from './api';

const translations = {
  en: { settings: 'Settings', support: 'Support', language: 'Language', theme: 'Theme', system: 'System', light: 'Light', dark: 'Dark', notifications: 'Notifications', save: 'Save changes', saved: 'Changes saved', account: 'Account', email: 'Email', phone: 'Phone', name: 'Name', help: 'Need help?', contactSupport: 'Contact support', findSchool: 'Find a school', admissions: 'Admissions', explore: 'Explore schools', apply: 'Apply for admission', verified: 'Verified profile', featured: 'Featured school' },
  hi: { settings: 'सेटिंग्स', support: 'सहायता', language: 'भाषा', theme: 'थीम', system: 'सिस्टम', light: 'लाइट', dark: 'डार्क', notifications: 'सूचनाएँ', save: 'बदलाव सहेजें', saved: 'बदलाव सहेजे गए', account: 'खाता', email: 'ईमेल', phone: 'फ़ोन', name: 'नाम', help: 'मदद चाहिए?', contactSupport: 'सपोर्ट से संपर्क करें', findSchool: 'स्कूल खोजें', admissions: 'प्रवेश', explore: 'स्कूल देखें', apply: 'प्रवेश के लिए आवेदन करें', verified: 'सत्यापित प्रोफ़ाइल', featured: 'विशेष स्कूल' }
};
const PreferenceContext = createContext(null);
export function PreferenceProvider({ children }) {
  const [prefs, setPrefs] = useState({ theme: localStorage.getItem('shikshly_theme') || 'system', language: localStorage.getItem('shikshly_language') || 'en' });
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { document.documentElement.lang = prefs.language; const dark = prefs.theme === 'dark' || (prefs.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches); document.documentElement.dataset.theme = dark ? 'dark' : 'light'; localStorage.setItem('shikshly_theme', prefs.theme); localStorage.setItem('shikshly_language', prefs.language); }, [prefs]);
  useEffect(() => { if (!localStorage.getItem('school_token')) return; request('/school/settings').then(r => { setPrefs(p => ({ ...p, ...r.preferences })); setLoaded(true); }).catch(() => setLoaded(true)); }, []);
  const t = useMemo(() => translations[prefs.language] || translations.en, [prefs.language]);
  const update = async (next) => { setPrefs(p => ({ ...p, ...next })); if (localStorage.getItem('school_token')) { try { const r = await request('/school/settings', { method: 'PATCH', body: JSON.stringify(next) }); setPrefs(p => ({ ...p, ...r.preferences })); } catch { /* local preference remains usable */ } } };
  return <PreferenceContext.Provider value={{ prefs, update, t, loaded }}>{children}</PreferenceContext.Provider>;
}
export function usePreferences() { return useContext(PreferenceContext); }
