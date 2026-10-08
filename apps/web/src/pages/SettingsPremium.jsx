import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Bell, Check, ChevronRight, Globe2, KeyRound, Laptop, LogOut, Moon, Palette, ShieldCheck, Smartphone, Star, Sun, UserRound, X } from 'lucide-react';
import { toast } from 'sonner';
import { clearToken, request, token } from '../api';
import { usePreferences } from '../preferences';

const row = 'group flex items-center gap-4 rounded-2xl border border-slate-200/80 bg-white p-4 transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_14px_35px_rgba(23,40,37,.07)]';

export default function SettingsPremium() {
  const { prefs, update, t } = usePreferences();
  const [me, setMe] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [form, setForm] = useState({ name: '', phone: '', theme: prefs.theme, language: prefs.language, emailNotifications: true, smsNotifications: true, productUpdates: true });
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [saving, setSaving] = useState(false);
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '' });

  const load = async () => {
    const [profile, sessionRows, appRating] = await Promise.all([request('/school/settings'), request('/auth/sessions'), request('/school/app-rating/me')]);
    setMe(profile.user); setSessions(sessionRows); setRating(appRating?.rating || 0); setFeedback(appRating?.feedback || '');
    setForm({ name: profile.user?.name || '', phone: profile.user?.phone || '', ...(profile.preferences || {}) });
  };
  useEffect(() => { if (token()) load().catch(e => toast.error(e.message)); }, []);

  const save = async () => {
    setSaving(true);
    try { const result = await request('/school/settings', { method: 'PATCH', body: JSON.stringify(form) }); setMe(result.user); await update(form); toast.success(t.saved || 'Changes saved'); }
    catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };
  const saveRating = async () => {
    if (!rating) return toast.error('Choose a rating first');
    try { await request('/school/app-rating/me', { method: 'PUT', body: JSON.stringify({ rating, feedback, platform: 'web', appVersion: '1.3.0' }) }); toast.success('Thanks for rating Shikshly'); }
    catch (e) { toast.error(e.message); }
  };
  const revoke = async (id) => { try { await request(`/auth/sessions/${id}`, { method: 'DELETE' }); setSessions(s => s.filter(x => x._id !== id)); toast.success('Session signed out'); } catch (e) { toast.error(e.message); } };
  const logout = () => { clearToken(); location.href = '/login'; };
  const changePassword = async () => {
    if (passwords.newPassword.length < 10) return toast.error('New password must be at least 10 characters');
    try { await request('/auth/change-password', { method: 'POST', body: JSON.stringify(passwords) }); setPasswords({ currentPassword: '', newPassword: '' }); await load(); toast.success('Password changed. Other sessions were signed out.'); }
    catch (e) { toast.error(e.message); }
  };

  return <main className="mx-auto max-w-6xl px-5 py-8 md:px-8 md:py-12">
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end">
      <div><p className="mb-2 text-xs font-bold uppercase tracking-[.18em] text-emerald-700">Workspace settings</p><h1 className="text-4xl font-semibold tracking-[-.04em] text-slate-900 md:text-5xl">Make Shikshly <span className="font-serif italic font-normal">yours.</span></h1><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">Manage your profile, preferences, security and feedback from one calm workspace.</p></div>
      <button onClick={save} disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-900/10 transition hover:-translate-y-0.5 disabled:opacity-60"><Check size={16}/>{saving ? 'Saving…' : 'Save changes'}</button>
    </motion.div>

    <div className="grid gap-5 lg:grid-cols-[1.35fr_.65fr]">
      <div className="space-y-5">
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-7">
          <div className="mb-6 flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><UserRound size={19}/></span><div><h2 className="font-semibold text-slate-900">Account</h2><p className="text-xs text-slate-500">Your identity across Shikshly.</p></div></div>
          <div className="grid gap-4 md:grid-cols-2"><label className="grid gap-2 text-xs font-semibold text-slate-600">Full name<input className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/10" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label className="grid gap-2 text-xs font-semibold text-slate-600">Email<input className="rounded-xl border border-slate-200 bg-slate-100 px-3.5 py-3 text-sm text-slate-500" value={me?.email || ''} disabled/></label><label className="grid gap-2 text-xs font-semibold text-slate-600">Phone<input className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm outline-none focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/10" value={form.phone || ''} onChange={e=>setForm({...form,phone:e.target.value})}/></label><div className="rounded-xl bg-emerald-50/70 p-3.5 text-xs text-emerald-900"><b>School role</b><p className="mt-1 text-emerald-800/70">{me?.email ? 'Your permissions are controlled by your school role.' : 'Sign in to load your role.'}</p></div></div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-7">
          <div className="mb-6 flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-50 text-violet-700"><Palette size={19}/></span><div><h2 className="font-semibold text-slate-900">Appearance & language</h2><p className="text-xs text-slate-500">Preferences sync to your account.</p></div></div>
          <div className="grid gap-4 md:grid-cols-2"><div><p className="mb-2 text-xs font-semibold text-slate-600">Theme</p><div className="grid grid-cols-3 gap-2">{[['system','System',Palette],['light','Light',Sun],['dark','Dark',Moon]].map(([value,label,Icon])=><button type="button" key={value} onClick={()=>setForm({...form,theme:value})} aria-pressed={form.theme===value} className={`rounded-xl border px-3 py-3 text-xs font-semibold transition ${form.theme===value?'border-emerald-500 bg-emerald-50 text-emerald-800':'border-slate-200 text-slate-600 hover:bg-slate-50'}`}><Icon size={16} className="mx-auto mb-1"/>{label}</button>)}</div></div><label className="grid gap-2 text-xs font-semibold text-slate-600">Language<select className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm outline-none focus:border-emerald-500" value={form.language || 'en'} onChange={e=>setForm({...form,language:e.target.value})}><option value="en">English</option><option value="hi">हिन्दी</option></select></label></div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-7"><div className="mb-6 flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-sky-50 text-sky-700"><Bell size={19}/></span><div><h2 className="font-semibold text-slate-900">Notifications</h2><p className="text-xs text-slate-500">Choose which updates reach you.</p></div></div><div className="space-y-2">{[['emailNotifications','Email notifications'],['smsNotifications','SMS notifications'],['productUpdates','Product updates']].map(([key,label])=><label key={key} className={row}><span className="flex-1 text-sm font-medium text-slate-700">{label}</span><input type="checkbox" className="peer sr-only" checked={form[key] ?? true} onChange={e=>setForm({...form,[key]:e.target.checked})}/><span className="relative h-6 w-11 rounded-full bg-slate-200 transition peer-checked:bg-emerald-600 after:absolute after:left-1 after:top-1 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow-sm after:transition peer-checked:after:translate-x-5"/></label>)}</div></section>
      </div>

      <aside className="space-y-5">
        <section className="rounded-3xl bg-slate-900 p-6 text-white shadow-xl shadow-slate-900/10"><div className="mb-5 flex items-center gap-3"><ShieldCheck className="text-emerald-300" size={20}/><div><h2 className="font-semibold">Security</h2><p className="text-xs text-slate-400">Active signed-in devices.</p></div></div><div className="space-y-2">{sessions.map((s,i)=><div key={s._id} className="flex items-center gap-3 rounded-2xl bg-white/5 p-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-white/10">{/Android|iPhone|Mobile/i.test(s.userAgent||'')?<Smartphone size={16}/>:<Laptop size={16}/>}</span><div className="min-w-0 flex-1"><b className="block truncate text-xs">{s.device || 'Web browser'} {i===0 && <span className="ml-1 text-emerald-300">• current</span>}</b><small className="block truncate text-[10px] text-slate-400">{new Date(s.createdAt).toLocaleString('en-IN')}</small></div>{i!==0&&<button onClick={()=>revoke(s._id)} aria-label="Sign out session" className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white"><X size={14}/></button>}</div>)}{!sessions.length&&<p className="text-xs text-slate-400">No active sessions found.</p>}</div><button onClick={logout} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-3 text-xs font-semibold hover:bg-white/10"><LogOut size={15}/> Sign out</button></section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-700"><KeyRound size={18}/></span><div><h2 className="font-semibold text-slate-900">Change password</h2><p className="text-xs text-slate-500">Changing it signs out your other active sessions.</p></div></div><div className="mt-4 space-y-3"><input type="password" value={passwords.currentPassword} onChange={e=>setPasswords({...passwords,currentPassword:e.target.value})} placeholder="Current password" className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm outline-none focus:border-emerald-500"/><input type="password" minLength={10} value={passwords.newPassword} onChange={e=>setPasswords({...passwords,newPassword:e.target.value})} placeholder="New password (10+ characters)" className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm outline-none focus:border-emerald-500"/><button onClick={changePassword} className="w-full rounded-xl border border-slate-200 px-4 py-3 text-xs font-semibold hover:bg-slate-50">Update password</button></div></section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-700"><Star size={18}/></span><div><h2 className="font-semibold text-slate-900">Rate the Shikshly app</h2><p className="text-xs text-slate-500">This is separate from your school's rating.</p></div></div><div className="mt-5 flex gap-1" role="radiogroup" aria-label="App rating">{[1,2,3,4,5].map(n=><button key={n} type="button" onClick={()=>setRating(n)} aria-label={`${n} stars`} className={`rounded-lg p-1 transition hover:scale-110 ${n<=rating?'text-amber-500':'text-slate-300'}`}><Star size={25} fill="currentColor"/></button>)}</div><textarea value={feedback} onChange={e=>setFeedback(e.target.value)} rows={4} placeholder="What could make Shikshly better?" className="mt-4 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm outline-none focus:border-amber-400 focus:bg-white"/><button onClick={saveRating} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-xs font-semibold text-white hover:bg-slate-800"><Star size={14}/> Submit app rating</button></section>

        <div className="rounded-3xl border border-emerald-100 bg-emerald-50 p-5 text-sm text-emerald-950"><div className="flex gap-3"><Globe2 size={18} className="mt-0.5 flex-none"/><p className="leading-6"><b>Privacy by design.</b> School data, app ratings and personal preferences are kept in their intended scopes. Use Support if something looks wrong.</p></div></div>
      </aside>
    </div>
  </main>;
}
