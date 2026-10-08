
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export const API =
  process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000/api';

const TOKEN_KEY = 'school_token';

export const getToken = () => {
  if (Platform.OS === 'web') {
    return Promise.resolve(localStorage.getItem(TOKEN_KEY));
  }

  return SecureStore.getItemAsync(TOKEN_KEY);
};

export const saveToken = (value) => {
  if (Platform.OS === 'web') {
    localStorage.setItem(TOKEN_KEY, value);
    return Promise.resolve();
  }

  return SecureStore.setItemAsync(TOKEN_KEY, value);
};

export const removeToken = () => {
  if (Platform.OS === 'web') {
    localStorage.removeItem(TOKEN_KEY);
    return Promise.resolve();
  }

  return SecureStore.deleteItemAsync(TOKEN_KEY);
};

export async function api(path, options = {}) {
  const headers = new Headers(options.headers);

  headers.set('Accept', 'application/json');

  if (options.body) {
    headers.set('Content-Type', 'application/json');
  }

  const t = await getToken();

  if (t) {
    headers.set('Authorization', `Bearer ${t}`);
  }

  const r = await fetch(`${API}${path}`, {
    ...options,
    headers,
  });

  const data = await r
    .json()
    .catch(() => ({ message: 'Could not read server response' }));

  if (!r.ok) {
    throw new Error(data.message || `Request failed (${r.status})`);
  }

  return data;
}

