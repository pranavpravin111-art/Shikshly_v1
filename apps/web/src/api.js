export const API = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
export function token() { return localStorage.getItem('school_token') || ''; }
export function setToken(value) { localStorage.setItem('school_token', value); }
export function clearToken() { localStorage.removeItem('school_token'); }
export async function request(path, options = {}) {
    const headers = new Headers(options.headers);
    headers.set('Accept', 'application/json');
    if (options.body && !headers.has('Content-Type'))
        headers.set('Content-Type', 'application/json');
    if (token())
        headers.set('Authorization', `Bearer ${token()}`);
    const response = await fetch(`${API}${path}`, { ...options, headers });
    const data = await response.json().catch(() => ({ message: 'The server returned an unreadable response' }));
    if (!response.ok)
        throw new Error(data.message || `Request failed (${response.status})`);
    return data;
}
