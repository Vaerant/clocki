import { useEffect, useRef, useState } from 'react';
import { LuTimer, LuDownload, LuCalendarDays, LuX, LuPlay, LuSquare, LuPlus, LuTrash2, LuChevronLeft, LuChevronRight } from 'react-icons/lu';

const pad = (n) => String(n).padStart(2, '0');
const hms = (s) => `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(Math.floor(s % 60))}`;
const hm = (s) => `${Math.floor(s / 3600)}h ${pad(Math.floor((s % 3600) / 60))}m`;
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const ymd = (d) => d.toLocaleDateString('en-CA');
const parse = (k) => new Date(`${k}T00:00:00`);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const monday = (d) => addDays(d, -((d.getDay() + 6) % 7));
const QUICK = [
  ['Today', () => [new Date(), new Date()]],
  ['Yesterday', () => [addDays(new Date(), -1), addDays(new Date(), -1)]],
  ['This week', () => [monday(new Date()), addDays(monday(new Date()), 6)]],
  ['Last week', () => [addDays(monday(new Date()), -7), addDays(monday(new Date()), -1)]],
  ['30 days', () => [addDays(new Date(), -29), new Date()]],
];
const Kbd = ({ children }) => <kbd className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-px font-mono text-[10px] text-zinc-400">{children}</kbd>;
const noFocus = (e) => e.target.closest('button') && e.preventDefault();
const Hint = ({ k, children }) => <span className="flex items-center gap-1.5"><Kbd>{k}</Kbd>{children}</span>;
const dateCls = 'h-8 min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 text-xs text-zinc-200 outline-none [color-scheme:dark] focus:border-zinc-600';
const iconBtn = 'rounded-md border border-zinc-800 p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100';
const Bar = ({ pct, dim }) => <div className="h-1 rounded-full bg-zinc-800"><div className={`h-1 rounded-full ${dim ? 'bg-zinc-600' : 'bg-zinc-300'}`} style={{ width: `${pct}%` }} /></div>;

export default function App() {
  const [s, setS] = useState(null), [sel, setSel] = useState(null), [now, setNow] = useState(Date.now());
  const [adding, setAdding] = useState(false), [draft, setDraft] = useState('');
  const [view, setView] = useState('clock'), [quick, setQuick] = useState(2), [only, setOnly] = useState(null), [days, setDays] = useState(null);
  const [range, setRange] = useState(() => { const [a, b] = QUICK[2][1](); return { from: ymd(a), to: ymd(b) }; });
  const inp = useRef();
  const [dragP, setDragP] = useState(null), [over, setOver] = useState(null);

  useEffect(() => {
    window.clock.get().then((x) => { setS(x); setSel(x.last); });
    const off = window.clock.onState(setS), t = setInterval(() => setNow(Date.now()), 1000);
    return () => { off(); clearInterval(t); };
  }, []);
  useEffect(() => { if (s?.running) setSel(s.preset); }, [s?.preset, s?.running]);
  useEffect(() => { if (s && sel !== null && !s.presets.includes(sel)) setSel(s.presets[0] ?? null); }, [s, sel]);
  useEffect(() => { if (adding) inp.current?.focus(); }, [adding]);
  useEffect(() => { document.querySelector('[data-sel="true"]')?.scrollIntoView({ block: 'nearest' }); }, [sel, s?.presets.length, view]);
  useEffect(() => { // stats: load + refresh so edits made in ActivityWatch show up
    if (view !== 'stats' || !range.from || !range.to || range.from > range.to) return;
    let live = true;
    const load = () => window.clock.stats(range).then((d) => live && setDays(d));
    load();
    const t = setInterval(load, 5000);
    return () => { live = false; clearInterval(t); };
  }, [view, range.from, range.to]);

  const P = s?.presets ?? [], run = !!s?.running, live = run && s.preset === sel;
  const toggle = () => (live ? window.clock.stop() : sel && window.clock.start(sel));
  const submit = async () => { const n = draft.trim(); if (n) { await window.clock.add(n); setSel(n); } setAdding(false); };
  const reorder = (a) => { setS((x) => ({ ...x, presets: a })); window.clock.reorder(a); };
  const dropOn = (t) => {
    if (dragP && dragP !== t) { const a = [...P]; a.splice(a.indexOf(dragP), 1); a.splice(P.indexOf(t), 0, dragP); reorder(a); }
    setDragP(null); setOver(null);
  };
  const setR = (a, b) => setRange({ from: ymd(a), to: ymd(b) });
  const pick = (i) => { setQuick(i); setR(...QUICK[i][1]()); };
  const step = (dir) => {
    const a = parse(range.from), b = parse(range.to), n = Math.round((b - a) / 864e5) + 1;
    setQuick(-1); setR(addDays(a, dir * n), addDays(b, dir * n));
  };

  useEffect(() => {
    const h = (e) => {
      if (e.target.tagName === 'INPUT') return;
      const k = e.key;
      if (s?.installed === false) { if (k === 'Escape') window.clock.hide(); else if (k === 'Enter') window.clock.install(); return; }
      if (k === 'Tab') { e.preventDefault(); setView((v) => (v === 'clock' ? 'stats' : 'clock')); return; }
      if (k === 'Escape') return window.clock.hide();
      if (view === 'stats') {
        if (k === 'ArrowLeft') step(-1); else if (k === 'ArrowRight') step(1); else if (/^[1-5]$/.test(k)) pick(k - 1);
        return;
      }
      if (!s) return;
      const i = P.indexOf(sel), go = (n) => P.length && setSel(P[(n + P.length) % P.length]);
      if ((e.altKey && (k === 'ArrowDown' || k === 'ArrowUp')) || (e.shiftKey && (k === 'J' || k === 'K'))) {
        e.preventDefault();
        const j = i + (k === 'ArrowDown' || k === 'J' ? 1 : -1);
        if (sel && j >= 0 && j < P.length) { const a = [...P]; [a[i], a[j]] = [a[j], a[i]]; reorder(a); }
        return;
      }
      if (k === 'ArrowDown' || k === 'j') go(i + 1);
      else if (k === 'ArrowUp' || k === 'k') go(i - 1);
      else if (/^[1-9]$/.test(k) && P[k - 1]) { setSel(P[k - 1]); if (run) window.clock.start(P[k - 1]); }
      else if (k === 'Enter' || k === ' ') { e.preventDefault(); toggle(); }
      else if (k === 'n') { e.preventDefault(); setDraft(''); setAdding(true); }
      else if (k === 'Delete' && sel) window.clock.remove(sel);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [s, sel, adding, view, range]);

  if (!s || s.installed === null) return null;
  if (s.installed === false) {
    const ins = s.install, busy = ins.phase === 'downloading';
    return (
      <div className="flex h-full flex-col p-4" onMouseDown={noFocus}>
        <div className="drag flex justify-end">
          <button onClick={() => window.clock.hide()} className="nodrag rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"><LuX size={14} /></button>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3"><LuDownload size={22} className="text-zinc-300" /></div>
          <div>
            <div className="text-base font-medium">ActivityWatch is required</div>
            <p className="mt-1 text-sm text-zinc-500">Clocki stores your sessions in ActivityWatch, and it isn't installed on this computer yet.</p>
          </div>
          <button onClick={() => window.clock.install()} disabled={busy}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-zinc-50 text-sm font-medium text-zinc-900 hover:bg-zinc-200 disabled:opacity-60">
            <LuDownload size={14} />{busy ? `Downloading… ${ins.pct}%` : ins.phase === 'launched' ? 'Run installer again' : 'Install ActivityWatch'}
          </button>
          {busy && <div className="w-full"><Bar pct={ins.pct} /></div>}
          {ins.phase === 'launched' && <p className="text-sm text-zinc-400">Installer opened. Finish the setup and this window will unlock automatically.</p>}
          {ins.phase === 'error' && <p className="text-sm text-red-400">{ins.error}</p>}
          <div className="flex gap-4 text-xs text-zinc-500">
            <button onClick={() => window.clock.site()} className="underline hover:text-zinc-300">Download page</button>
            <button onClick={() => window.clock.recheck()} className="underline hover:text-zinc-300">Check again</button>
          </div>
        </div>
        <div className="flex gap-3 border-t border-zinc-800 pt-3 text-xs text-zinc-500"><Hint k="Enter">Install</Hint><Hint k="Esc">Hide</Hint></div>
      </div>
    );
  }
  const el = run && s.since ? Math.max(0, (now - s.since) / 1000) : 0;
  const xToday = run ? Math.max(0, now - Math.max(s.since, s.dayStart)) / 1000 : 0;
  const xWeek = run ? Math.max(0, now - Math.max(s.since, s.weekStart)) / 1000 : 0;

  // stats view data
  const keys = [];
  if (range.from <= range.to) for (let d = parse(range.from); ymd(d) <= range.to && keys.length < 366; d = addDays(d, 1)) keys.push(ymd(d));
  const dayTotal = (k) => { const m = days?.[k] || {}; return only ? m[only] || 0 : sum(m); };
  const byPreset = {};
  keys.forEach((k) => Object.entries(days?.[k] || {}).forEach(([p, v]) => (byPreset[p] = (byPreset[p] || 0) + v)));
  const presetRows = Object.entries(byPreset).sort((a, b) => b[1] - a[1]);
  const total = keys.reduce((a, k) => a + dayTotal(k), 0), active = keys.filter((k) => dayTotal(k) > 0).length;
  const dayRows = keys.filter((k) => keys.length <= 14 || dayTotal(k) > 0), maxDay = Math.max(1, ...keys.map(dayTotal));

  return (
    <div className="flex h-full flex-col gap-3 p-4" onMouseDown={noFocus}>
      <div className="drag flex items-center justify-between">
        <div className="nodrag flex gap-1">
          {[['clock', 'Clock', LuTimer], ['stats', 'Stats', LuCalendarDays]].map(([id, label, Icon]) => (
            <button key={id} onClick={() => setView(id)} className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium ${view === id ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-500 hover:text-zinc-300'}`}><Icon size={13} />{label}</button>
          ))}
        </div>
        <div className="nodrag flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-xs text-zinc-500">
            <span className={`size-1.5 rounded-full ${s.online ? 'bg-emerald-500' : 'bg-red-500'}`} />{s.online ? 'ActivityWatch' : 'AW offline'}
          </span>
          <button onClick={() => window.clock.hide()} className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"><LuX size={14} /></button>
        </div>
      </div>

      {view === 'clock' ? (<>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 text-center">
          <div className={`font-mono text-5xl font-semibold tracking-tight tabular-nums ${run ? 'text-zinc-50' : 'text-zinc-600'}`}>{hms(el)}</div>
          <div className="mt-2 truncate text-sm text-zinc-400">{run ? s.preset : sel || 'No preset selected'}</div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {[['Today', sum(s.totals) + xToday], ['This week', s.weekTotal + xWeek]].map(([l, v]) => (
            <div key={l} className="rounded-lg border border-zinc-800 px-3 py-2">
              <div className="text-xs text-zinc-500">{l}</div>
              <div className="font-mono text-sm tabular-nums text-zinc-200">{hm(v)}</div>
            </div>
          ))}
        </div>

        <button onClick={toggle} disabled={!sel}
          className={`flex h-10 items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50 ${live ? 'border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20' : 'bg-zinc-50 text-zinc-900 hover:bg-zinc-200'}`}>
          {live ? <><LuSquare size={14} /> Clock out</> : run ? <>Switch to {sel}</> : <><LuPlay size={14} /> Clock in</>}
        </button>

        <div className="flex-1 space-y-0.5 overflow-y-auto">
          {P.length === 0 && !adding && <div className="pt-6 text-center text-sm text-zinc-500">No presets yet. Press <Kbd>N</Kbd> to add one.</div>}
          {P.map((p, i) => (
            <div key={p} data-sel={p === sel} draggable onDragStart={() => setDragP(p)} onDragEnd={() => { setDragP(null); setOver(null); }} onDragEnter={() => setOver(p)} onDragOver={(e) => e.preventDefault()} onDrop={() => dropOn(p)} onClick={() => setSel(p)} onDoubleClick={() => (setSel(p), window.clock.start(p))}
              className={`flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-md px-2 ${dragP === p ? 'opacity-40' : ''} ${over === p && dragP && dragP !== p ? 'ring-1 ring-zinc-500' : ''} ${p === sel ? 'bg-zinc-800/70 text-zinc-50' : 'text-zinc-400 hover:bg-zinc-900'}`}>
              {i < 9 ? <Kbd>{i + 1}</Kbd> : <span className="w-5" />}
              <span className="flex-1 truncate">{p}</span>
              {run && s.preset === p && <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />}
              <span className="text-xs tabular-nums text-zinc-500">{hm((s.totals[p] || 0) + (run && s.preset === p ? xToday : 0))}</span>
            </div>
          ))}
          {adding && (
            <div className="flex h-9 items-center gap-2 rounded-md border border-zinc-700 px-2">
              <LuPlus size={14} className="text-zinc-500" />
              <input ref={inp} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => setAdding(false)} placeholder="Preset name, Enter to save"
                onKeyDown={(e) => (e.key === 'Enter' ? submit() : e.key === 'Escape' && setAdding(false))}
                className="flex-1 bg-transparent outline-none placeholder:text-zinc-600" />
            </div>
          )}
        </div>
      </>) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap gap-1">
            {QUICK.map(([name], i) => (
              <button key={name} onClick={() => pick(i)} className={`h-7 rounded-md border px-2 text-xs ${quick === i ? 'border-zinc-50 bg-zinc-50 text-zinc-900' : 'border-zinc-800 text-zinc-400 hover:bg-zinc-800'}`}>{name}</button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => step(-1)} className={iconBtn}><LuChevronLeft size={14} /></button>
            <input type="date" className={dateCls} value={range.from} onChange={(e) => { const v = e.target.value; if (v) { setQuick(-1); setRange((r) => ({ from: v, to: v > r.to ? v : r.to })); } }} />
            <input type="date" className={dateCls} value={range.to} onChange={(e) => { const v = e.target.value; if (v) { setQuick(-1); setRange((r) => ({ from: v < r.from ? v : r.from, to: v })); } }} />
            <button onClick={() => step(1)} className={iconBtn}><LuChevronRight size={14} /></button>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
            <div className="truncate text-xs text-zinc-500">{only ?? 'All presets'}</div>
            <div className="font-mono text-3xl font-semibold tabular-nums">{hms(total)}</div>
            <div className="text-xs text-zinc-500">{active} active {active === 1 ? 'day' : 'days'} · avg {hm(active ? total / active : 0)} / day</div>
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto pr-1">
            {!s.online && days === null ? <div className="pt-4 text-center text-sm text-zinc-500">ActivityWatch is offline.</div> : <>
              <div>
                <div className="mb-1.5 text-xs font-medium text-zinc-500">By preset {only && <button onClick={() => setOnly(null)} className="ml-1 text-zinc-400 underline">clear filter</button>}</div>
                <div className="space-y-2">
                  {presetRows.length === 0 && <div className="text-sm text-zinc-600">No time logged in this range.</div>}
                  {presetRows.map(([p, v]) => (
                    <button key={p} onClick={() => setOnly(only === p ? null : p)} className={`block w-full space-y-1 text-left ${only && only !== p ? 'opacity-40' : ''}`}>
                      <div className="flex justify-between text-sm"><span className="truncate">{p}</span><span className="text-xs tabular-nums text-zinc-500">{hm(v)}</span></div>
                      <Bar pct={(v / presetRows[0][1]) * 100} />
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-xs font-medium text-zinc-500">By day</div>
                <div className="space-y-2">
                  {dayRows.map((k) => (
                    <div key={k} className="space-y-1">
                      <div className="flex justify-between text-sm"><span className="text-zinc-300">{parse(k).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</span><span className="text-xs tabular-nums text-zinc-500">{hm(dayTotal(k))}</span></div>
                      <Bar pct={(dayTotal(k) / maxDay) * 100} dim />
                    </div>
                  ))}
                </div>
              </div>
            </>}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-zinc-800 pt-3 text-xs text-zinc-500">
        {view === 'clock' ? <>
          <Hint k="↑↓">Move</Hint><Hint k="Enter">In/out</Hint><Hint k="N">New</Hint><Hint k="Alt+↑↓">Reorder</Hint>
          <span className="flex items-center gap-1.5"><Kbd>Del</Kbd><LuTrash2 size={11} /></span><Hint k="Tab">Stats</Hint><Hint k="Esc">Hide</Hint>
        </> : <>
          <Hint k="←→">Step</Hint><Hint k="1-5">Range</Hint><Hint k="Tab">Clock</Hint><Hint k="Esc">Hide</Hint>
        </>}
      </div>
    </div>
  );
}
