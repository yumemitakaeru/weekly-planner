import { useState, useRef } from "react";

const HOURS = Array.from({ length: 21 }, (_, i) => i + 4);
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAY_JA = ["月", "火", "水", "木", "金", "土", "日"];
const DEFAULT_CATS = [
  { name:"Study",    color:"#3b82f6" },
  { name:"Work",     color:"#7c3aed" },
  { name:"Exercise", color:"#16a34a" },
  { name:"Personal", color:"#d97706" },
  { name:"Other",    color:"#94a3b8" },
];

// アクセントカラーからbg/textを生成
function colorSet(hex) {
  return { bg: hex + "20", border: hex, text: hex };
}

const SLOT_HEIGHT = 48;
const TIME_COL_W = 52;
const LS_KEY = "wplanner_v3";

function load() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch { return null; }
}
function save(data) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch {}
}

function makeEmptyWeek(label = "") {
  const events = {}, reflections = {};
  DAYS.forEach(d => { events[d] = []; reflections[d] = { mark: "", reflection: "", tasks: [] }; });
  const dayTargetMin = {};
  DAYS.forEach(d => { dayTargetMin[d] = 0; }); // 0 = 未設定
  return { label, events, reflections, weekNote: "", targetMin: 240, dayTargetMin, dateFrom: "", dateTo: "", createdAt: Date.now() };
}

function getDefaultLabel() { return ""; }

function timeToFrac(s) { const [h, m] = s.split(":").map(Number); return h + (m||0)/60; }
function fracToTime(f) {
  const h = Math.floor(f), m = Math.round((f-h)*60);
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}

function initStore() {
  const stored = load();
  if (stored?.weeks && stored?.currentId) return stored;
  const id = Date.now().toString();
  return { weeks: { [id]: makeEmptyWeek(getDefaultLabel()) }, currentId: id, categories: DEFAULT_CATS };
}

// ── PDF出力用HTML生成 ──────────────────────────────
function buildPrintHTML(w) {
  const { label, events, reflections, weekNote, targetMin } = w;
  // ── JSONエクスポート ──
  function exportData() {
    const json = JSON.stringify(store, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `weekly_planner_backup_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ── JSONインポート ──
  function importData(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (!parsed.weeks || !parsed.currentId) throw new Error("フォーマット不正");
        // 既存データとマージ（既存週は保持、インポート週を上書き追加）
        setStore(prev => {
          const merged = { weeks: { ...prev.weeks, ...parsed.weeks }, currentId: parsed.currentId };
          save(merged);
          return merged;
        });
        setSyncMsg({ type:"ok", text: `${Object.keys(parsed.weeks).length}週分をインポートしました` });
        setTimeout(() => setSyncMsg(null), 3000);
      } catch(err) {
        setSyncMsg({ type:"err", text: "インポート失敗: " + err.message });
        setTimeout(() => setSyncMsg(null), 4000);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  // ── AIフィードバック生成 ──
  function updateCategories(newCats) {
    setStore(prev => { const n = { ...prev, categories: newCats }; save(n); return n; });
  }

  const totalMin = Object.values(events).flat().reduce((s,e) =>
    s + (timeToFrac(e.endTime) - timeToFrac(e.startTime))*60, 0);

  const SH = 20; // 印刷用スロット高さ(px)
  const TCW = 36;

  // グリッド列
  const dayCols = DAYS.map((day, di) => {
    const dayEvs = events[day];
    const blocks = dayEvs.map(ev => {
      const s = timeToFrac(ev.startTime), en = timeToFrac(ev.endTime);
      const top = (s - 4) * SH;
      const height = Math.max((en - s) * SH - 1, 8);
      const col = catColors[ev.category] || colorSet('#94a3b8');
      return `<div style="position:absolute;top:${top+1}px;left:1px;right:1px;height:${height}px;background:${col.bg};border-left:2px solid ${col.border};border-radius:2px;padding:1px 3px;overflow:hidden;font-size:7px;color:${col.text};font-weight:700;">${ev.title}<br><span style="font-weight:400;opacity:0.7;">${ev.startTime}–${ev.endTime}</span></div>`;
    }).join("");
    const gridLines = HOURS.map((h,hi) =>
      `<div style="position:absolute;top:${hi*SH}px;left:0;right:0;border-top:1px solid ${h%3===0?"#e2e8f0":"#f1f5f9"};"></div>`
    ).join("");
    return `<div style="flex:1;height:${HOURS.length*SH}px;position:relative;border-left:1px solid #f1f5f9;background:${di%2===0?"#fff":"#fafbfc"};">${gridLines}${blocks}</div>`;
  }).join("");

  // 時間軸
  const timeAxis = HOURS.map(h =>
    `<div style="height:${SH}px;text-align:right;padding-right:4px;padding-top:2px;color:#cbd5e1;font-size:7px;">${h}:00</div>`
  ).join("");

  // 曜日ヘッダー
  const dayHeader = DAYS.map((d,i) =>
    `<div style="flex:1;text-align:center;padding:4px 0;font-size:8px;color:${i>=5?"#d97706":"#64748b"};font-weight:600;text-transform:uppercase;">${DAY_JA[i]} ${d.slice(0,3)}</div>`
  ).join("");

  // Reflection
  const refRows = DAYS.map((day,i) => {
    const r = reflections[day];
    const mins = events[day].reduce((s,e) => s+(timeToFrac(e.endTime)-timeToFrac(e.startTime))*60, 0);
    return `
      <div style="border:1px solid #e2e8f0;border-radius:4px;padding:6px 8px;background:#fff;">
        <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
          <span style="font-size:8px;font-weight:700;color:${i>=5?"#d97706":"#64748b"};text-transform:uppercase;">${DAY_JA[i]} ${day}</span>
          <span style="font-size:8px;color:#3b82f6;font-weight:700;">${(mins/60).toFixed(1)}h  ${r.mark||"—"}</span>
        </div>
        <div style="font-size:7.5px;color:#475569;min-height:14px;">${r.reflection || ""}</div>
      </div>`;
  }).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'Courier New',monospace;background:#fff;color:#0f172a;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  @page{size:A4 landscape;margin:10mm;}
  @media print{body{margin:0;}}
</style>
</head><body>
<div style="padding:0;">
  <!-- ヘッダー -->
  <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #e2e8f0;padding-bottom:6px;margin-bottom:8px;">
    <div>
      <span style="font-size:8px;color:#94a3b8;letter-spacing:3px;text-transform:uppercase;">WEEKLY PLANNER</span>
      <span style="font-size:16px;font-weight:700;color:#0f172a;margin-left:10px;">${(w.dateFrom&&w.dateTo) ? w.dateFrom+"〜"+w.dateTo : label||"—"}</span>
    </div>
    <div style="font-size:8px;color:#475569;">
      実績: <b>${(totalMin/60).toFixed(1)}h</b> / 目標: ${(targetMin/60).toFixed(1)}h
      &nbsp;&nbsp;差分: <b style="color:${totalMin>=targetMin?"#16a34a":"#dc2626"}">${totalMin>=targetMin?"+":""}${((totalMin-targetMin)/60).toFixed(1)}h</b>
    </div>
  </div>

  <!-- メインレイアウト：グリッド左・Reflection右 -->
  <div style="display:flex;gap:10px;">

    <!-- スケジュールグリッド -->
    <div style="flex:2;">
      <div style="display:flex;margin-left:${TCW}px;border-bottom:1px solid #e2e8f0;">${dayHeader}</div>
      <div style="display:flex;">
        <div style="width:${TCW}px;flex-shrink:0;border-right:1px solid #e2e8f0;">${timeAxis}</div>
        ${dayCols}
      </div>
    </div>

    <!-- Reflection -->
    <div style="flex:1;display:flex;flex-direction:column;gap:5px;">
      <div style="font-size:8px;color:#94a3b8;letter-spacing:2px;text-transform:uppercase;margin-bottom:2px;">REFLECTION</div>
      ${refRows}
      ${weekNote ? `<div style="border:1px solid #e2e8f0;border-radius:4px;padding:6px 8px;background:#f8fafc;"><div style="font-size:7px;color:#94a3b8;text-transform:uppercase;margin-bottom:3px;">Week Note</div><div style="font-size:7.5px;color:#334155;">${weekNote}</div></div>` : ""}
    </div>

  </div>
</div>
</body></html>`;
}

export default function App() {
  const [store, setStore] = useState(initStore);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ title: "", category: "Study", note: "", startTime: "09:00", endTime: "10:00" });
  const [activeTab, setActiveTab] = useState("schedule");
  const [showHistory, setShowHistory] = useState(false);
  const [pdfModal, setPdfModal] = useState(false);
  const [pdfTarget, setPdfTarget] = useState(null); // week id
  const [syncMsg, setSyncMsg] = useState(null); // { type:"ok"|"err", text }
  const importRef = useRef(null);
  const [aiModal, setAiModal] = useState(false);
  const [newWeekInput, setNewWeekInput] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [catModal, setCatModal] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiFeedback, setAiFeedback] = useState(null); // { weekLabel, text, createdAt }

  const { weeks, currentId } = store;
  const categories = store.categories || DEFAULT_CATS;
  const catColors = Object.fromEntries(categories.map(c => [c.name, colorSet(c.color)]));
  const week = weeks[currentId] || makeEmptyWeek();
  const { events, reflections, weekNote, targetMin, label: weekLabel, dateFrom = "", dateTo = "" } = week;
  const dayTargetMin = week.dayTargetMin || Object.fromEntries(DAYS.map(d => [d, 0]));

  function updateStore(patch) {
    setStore(prev => {
      const next = { ...prev, weeks: { ...prev.weeks, [prev.currentId]: { ...prev.weeks[prev.currentId], ...patch } } };
      save(next); return next;
    });
  }

  function switchWeek(id) {
    setStore(prev => { const n = { ...prev, currentId: id }; save(n); return n; });
    setShowHistory(false);
  }

  function startNewWeek(label) {
    if (!label || !label.trim()) return;
    const id = Date.now().toString();
    setStore(prev => {
      const n = { weeks: { ...prev.weeks, [id]: makeEmptyWeek(label.trim()) }, currentId: id };
      save(n); return n;
    });
    setNewWeekInput("");
    setShowHistory(false);
  }

  function deleteWeek(id) {
    if (Object.keys(weeks).length <= 1) { alert("最後の週は削除できません"); return; }
    if (!window.confirm("この週のデータを削除しますか？")) return;
    setStore(prev => {
      const nw = { ...prev.weeks }; delete nw[id];
      const nid = prev.currentId === id
        ? Object.keys(nw).sort((a,b) => nw[b].createdAt - nw[a].createdAt)[0]
        : prev.currentId;
      const n = { weeks: nw, currentId: nid }; save(n); return n;
    });
  }

  function handleGridClick(day, e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const snapped = Math.round(((e.clientY - rect.top) / SLOT_HEIGHT + 4) * 4) / 4;
    const start = Math.max(4, Math.min(snapped, 23.75));
    setForm({ title: "", category: "Study", note: "", startTime: fracToTime(start), endTime: fracToTime(Math.min(start+1,24)) });
    setModal({ mode: "new", day });
  }

  function handleEventClick(day, ev, e) {
    e.stopPropagation();
    setForm({ title: ev.title, category: ev.category, note: ev.note||"", startTime: ev.startTime, endTime: ev.endTime });
    setModal({ mode: "edit", day, id: ev.id });
  }

  function saveEvent() {
    if (!form.title.trim()) return;
    const ne = { ...events };
    if (modal.mode === "new") ne[modal.day] = [...ne[modal.day], { ...form, id: Date.now() }];
    else ne[modal.day] = ne[modal.day].map(ev => ev.id === modal.id ? { ...ev, ...form } : ev);
    updateStore({ events: ne }); setModal(null);
  }

  function deleteEvent() {
    updateStore({ events: { ...events, [modal.day]: events[modal.day].filter(ev => ev.id !== modal.id) } });
    setModal(null);
  }

  // ── PDF出力実行 ──
  function executePrint(id) {
    const targetWeek = weeks[id];
    if (!targetWeek) return;
    const html = buildPrintHTML(targetWeek);
    // Blob URL経由でHTMLファイルをダウンロード → ブラウザで開いてCtrl+P
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const filename = ((targetWeek.dateFrom||targetWeek.label||"week").replace(/[^a-zA-Z0-9_\-]/g, "_")) + "_schedule.html";
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setPdfModal(false);
  }

  // ── JSONエクスポート ──
  function exportData() {
    const json = JSON.stringify(store, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `weekly_planner_backup_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ── JSONインポート ──
  function importData(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (!parsed.weeks || !parsed.currentId) throw new Error("フォーマット不正");
        // 既存データとマージ（既存週は保持、インポート週を上書き追加）
        setStore(prev => {
          const merged = { weeks: { ...prev.weeks, ...parsed.weeks }, currentId: parsed.currentId };
          save(merged);
          return merged;
        });
        setSyncMsg({ type:"ok", text: `${Object.keys(parsed.weeks).length}週分をインポートしました` });
        setTimeout(() => setSyncMsg(null), 3000);
      } catch(err) {
        setSyncMsg({ type:"err", text: "インポート失敗: " + err.message });
        setTimeout(() => setSyncMsg(null), 4000);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  // ── AIフィードバック生成 ──
  async function generateFeedback() {
    setAiLoading(true);
    setAiFeedback(null);

    // 週データをテキスト化
    const catMins = {};
    categories.forEach(c => { catMins[c.name] = 0; });
    const allEvs = Object.values(events).flat();
    allEvs.forEach(ev => {
      const m = (timeToFrac(ev.endTime) - timeToFrac(ev.startTime)) * 60;
      catMins[ev.category] = (catMins[ev.category] || 0) + m;
    });
    const wTotal = Object.values(catMins).reduce((s,v)=>s+v,0);

    const dayLines = DAYS.map((day, i) => {
      const dayEvs = events[day];
      const dayMin = dayEvs.reduce((s,e)=>s+(timeToFrac(e.endTime)-timeToFrac(e.startTime))*60,0);
      const r = reflections[day];
      const evList = dayEvs.map(e=>`    - ${e.title}(${e.category}) ${e.startTime}~${e.endTime}`).join("\n");
      return `【${DAY_JA[i]}曜日】 合計${(dayMin/60).toFixed(1)}h\n${evList||"    （予定なし）"}\n  Reflection: ${r.reflection||"なし"} / Mark: ${r.mark||"—"}`;
    }).join("\n");

    const catLines = categories.map(c =>
      `  ${c.name}: ${(catMins[c.name]/60).toFixed(1)}h (${wTotal>0?Math.round(catMins[c.name]/wTotal*100):0}%)`
    ).join("\n");

    const prompt = `あなたは週次スケジュールのコーチです。以下のデータを分析して、日本語で構造的なフィードバックをしてください。

## 週: ${dateFrom||"未設定"}〜${dateTo||"未設定"}
## 目標学習時間（週合計）: ${(targetMin/60).toFixed(1)}h / 実績: ${(wTotal/60).toFixed(1)}h / 達成率: ${targetMin>0?Math.round(wTotal/targetMin*100):0}%
## 曜日別目標: ${DAYS.map((d,i)=>{ const t=dayTargetMin[d]||0; const actual=events[d].reduce((s,e)=>s+(timeToFrac(e.endTime)-timeToFrac(e.startTime))*60,0); return t>0?`${DAY_JA[i]}:目標${(t/60).toFixed(1)}h/実績${(actual/60).toFixed(1)}h`:`${DAY_JA[i]}:目標未設定`; }).join(', ')}

## カテゴリ別時間配分:
${catLines}

## 日別スケジュール・Reflection:
${dayLines}

## 週次振り返り:
${weekNote || "なし"}

---
以下の4点について、それぞれ具体的にフィードバックしてください。箇条書きは使わず、各項目を見出し付きで記述してください。
1. 学習時間・達成率の評価
2. カテゴリ別時間配分のバランス分析
3. 日別Reflectionから読み取れる傾向・課題
4. 来週に向けた具体的な改善提案（行動レベルまで分解）`;

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{ role: "user", content: prompt }]
        })
      });
      const data = await res.json();
      const text = data.content?.find(b => b.type === "text")?.text || "フィードバックを取得できませんでした。";
      setAiFeedback({ weekLabel: (dateFrom||"未設定")+"〜"+(dateTo||""), text, createdAt: Date.now() });
    } catch(err) {
      setAiFeedback({ weekLabel: (dateFrom||"未設定")+"〜"+(dateTo||""), text: "エラーが発生しました: " + err.message, createdAt: Date.now() });
    }
    setAiLoading(false);
  }

  function updateCategories(newCats) {
    setStore(prev => { const n = { ...prev, categories: newCats }; save(n); return n; });
  }

  const totalMin = Object.values(events).flat().reduce((s,e) =>
    s + (timeToFrac(e.endTime) - timeToFrac(e.startTime))*60, 0);
  const progress = Math.min(totalMin/targetMin, 1);
  const diffMin = totalMin - targetMin;
  const sortedWeeks = Object.entries(weeks).sort((a,b) => b[1].createdAt - a[1].createdAt);

  const B = { border:"none", cursor:"pointer", fontFamily:"inherit" };
  const inputBase = { fontFamily:"inherit", fontSize:12, background:"#fff", border:"1px solid #e2e8f0", borderRadius:5, padding:"6px 8px", color:"#0f172a", boxSizing:"border-box", width:"100%" };

  return (
    <div style={{ minHeight:"100vh", background:"#f8fafc", color:"#0f172a", fontFamily:"'DM Mono','Courier New',monospace", fontSize:13 }}>

      {/* ヘッダー：1行目 */}
      <div style={{ background:"#fff", borderBottom:"1px solid #e2e8f0", padding:"10px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, boxShadow:"0 1px 3px rgba(0,0,0,0.06)" }}>
        {/* 左：ハンバーガー＋タイトル＋日付 */}
        <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
          <button onClick={() => setMenuOpen(o=>!o)}
            style={{ ...B, width:32, height:32, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:4, background: menuOpen?"#f1f5f9":"transparent", border:"1px solid #e2e8f0", borderRadius:7, padding:0 }}>
            {[0,1,2].map(i => <span key={i} style={{ width:14, height:1.5, background: menuOpen?"#3b82f6":"#94a3b8", borderRadius:2, transition:"all 0.2s" }} />)}
          </button>
          <span style={{ fontSize:9, letterSpacing:3, color:"#94a3b8", textTransform:"uppercase", whiteSpace:"nowrap" }}>Weekly Planner</span>
          <span style={{ width:1, height:12, background:"#e2e8f0", display:"inline-block" }} />
          <input type="date" value={dateFrom} onChange={e => updateStore({ dateFrom: e.target.value })}
            style={{ fontSize:13, fontWeight:700, color:"#0f172a", background:"transparent", border:"none", borderBottom:"2px solid #e2e8f0", outline:"none", fontFamily:"inherit", width:118 }} />
          <span style={{ color:"#cbd5e1", fontSize:12 }}>〜</span>
          <input type="date" value={dateTo} onChange={e => updateStore({ dateTo: e.target.value })}
            style={{ fontSize:13, fontWeight:700, color:"#0f172a", background:"transparent", border:"none", borderBottom:"2px solid #e2e8f0", outline:"none", fontFamily:"inherit", width:118 }} />
        </div>

        {/* 中：進捗バー */}
        <div style={{ display:"flex", alignItems:"center", gap:8, flex:1, maxWidth:400 }}>
          <span style={{ color:"#94a3b8", fontSize:10, whiteSpace:"nowrap" }}>TARGET</span>
          <input type="number" value={(targetMin/60).toFixed(1)} step="0.5" min="0"
            onChange={e => updateStore({ targetMin: Math.round(Number(e.target.value) * 60) })}
            style={{ width:50, background:"#f8fafc", border:"1px solid #e2e8f0", color:"#0f172a", borderRadius:5, padding:"2px 6px", fontSize:11, textAlign:"center" }} />
          <span style={{ color:"#cbd5e1", fontSize:10 }}>h</span>
          <div style={{ flex:1, height:5, background:"#e2e8f0", borderRadius:3, overflow:"hidden" }}>
            <div style={{ width:`${progress*100}%`, height:"100%", background: progress>=1?"#16a34a":"#3b82f6", borderRadius:3, transition:"width 0.4s" }} />
          </div>
          <span style={{ color:"#475569", fontSize:11, whiteSpace:"nowrap" }}>{(totalMin/60).toFixed(1)}/{(targetMin/60).toFixed(1)}h</span>
          <span style={{ color: diffMin>=0?"#16a34a":"#dc2626", fontSize:10, fontWeight:700 }}>{diffMin>=0?"+":""}{(diffMin/60).toFixed(1)}h</span>
        </div>

        {/* 右：タブ */}
        <div style={{ display:"flex", gap:2, background:"#f1f5f9", borderRadius:7, padding:3, flexShrink:0 }}>
          {["schedule","reflection"].map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              style={{ ...B, padding:"5px 14px", borderRadius:5, background: activeTab===tab?"#fff":"transparent", color: activeTab===tab?"#0f172a":"#94a3b8", fontSize:10, letterSpacing:1, textTransform:"uppercase", boxShadow: activeTab===tab?"0 1px 3px rgba(0,0,0,0.08)":"none" }}>
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* ハンバーガーメニュー */}
      {menuOpen && (
        <div onClick={() => setMenuOpen(false)} style={{ position:"fixed", inset:0, zIndex:50 }} />
      )}
      {menuOpen && (
        <div style={{ position:"fixed", top:52, left:16, zIndex:51, background:"#fff", border:"1px solid #e2e8f0", borderRadius:10, boxShadow:"0 8px 32px rgba(0,0,0,0.12)", minWidth:200, overflow:"hidden" }}>
          {/* 週管理グループ */}
          <div style={{ padding:"6px 0", borderBottom:"1px solid #f1f5f9" }}>
            <div style={{ fontSize:9, color:"#cbd5e1", letterSpacing:2, textTransform:"uppercase", padding:"4px 16px 2px" }}>週管理</div>
            <button onClick={() => { setShowHistory(h=>!h); setMenuOpen(false); }}
              style={{ ...B, display:"flex", alignItems:"center", gap:10, width:"100%", padding:"9px 16px", background:"none", color:"#334155", fontSize:13, textAlign:"left" }}>
              <span style={{ fontSize:15 }}>📅</span> 履歴 ({sortedWeeks.length})
            </button>
            <button onClick={() => { startNewWeek("新しい週"); setMenuOpen(false); }}
              style={{ ...B, display:"flex", alignItems:"center", gap:10, width:"100%", padding:"9px 16px", background:"none", color:"#16a34a", fontSize:13, textAlign:"left" }}>
              <span style={{ fontSize:15 }}>➕</span> New Week
            </button>
          </div>
          {/* データグループ */}
          <div style={{ padding:"6px 0", borderBottom:"1px solid #f1f5f9" }}>
            <div style={{ fontSize:9, color:"#cbd5e1", letterSpacing:2, textTransform:"uppercase", padding:"4px 16px 2px" }}>データ</div>
            <button onClick={() => { setPdfTarget(currentId); setPdfModal(true); setMenuOpen(false); }}
              style={{ ...B, display:"flex", alignItems:"center", gap:10, width:"100%", padding:"9px 16px", background:"none", color:"#c2410c", fontSize:13, textAlign:"left" }}>
              <span style={{ fontSize:15 }}>📄</span> PDF出力
            </button>
            <button onClick={() => { exportData(); setMenuOpen(false); }}
              style={{ ...B, display:"flex", alignItems:"center", gap:10, width:"100%", padding:"9px 16px", background:"none", color:"#0369a1", fontSize:13, textAlign:"left" }}>
              <span style={{ fontSize:15 }}>⬆️</span> エクスポート
            </button>
            <button onClick={() => { importRef.current.click(); setMenuOpen(false); }}
              style={{ ...B, display:"flex", alignItems:"center", gap:10, width:"100%", padding:"9px 16px", background:"none", color:"#7c3aed", fontSize:13, textAlign:"left" }}>
              <span style={{ fontSize:15 }}>⬇️</span> インポート
            </button>
            <input ref={importRef} type="file" accept=".json" onChange={importData} style={{ display:"none" }} />
          </div>
          {/* 設定グループ */}
          <div style={{ padding:"6px 0", borderBottom:"1px solid #f1f5f9" }}>
            <div style={{ fontSize:9, color:"#cbd5e1", letterSpacing:2, textTransform:"uppercase", padding:"4px 16px 2px" }}>設定</div>
            <button onClick={() => { setCatModal(true); setMenuOpen(false); }}
              style={{ ...B, display:"flex", alignItems:"center", gap:10, width:"100%", padding:"9px 16px", background:"none", color:"#334155", fontSize:13, textAlign:"left" }}>
              <span style={{ fontSize:15 }}>🎨</span> カテゴリ設定
            </button>
          </div>
          {/* AIグループ */}
          <div style={{ padding:"6px 0" }}>
            <div style={{ fontSize:9, color:"#cbd5e1", letterSpacing:2, textTransform:"uppercase", padding:"4px 16px 2px" }}>AI</div>
            <button onClick={() => { setAiModal(true); setMenuOpen(false); }}
              style={{ ...B, display:"flex", alignItems:"center", gap:10, width:"100%", padding:"9px 16px", background:"none", color:"#a21caf", fontSize:13, textAlign:"left", fontWeight:600 }}>
              <span style={{ fontSize:15 }}>✦</span> AIフィードバック
            </button>
          </div>
          {syncMsg && (
            <div style={{ padding:"8px 16px", borderTop:"1px solid #f1f5f9", fontSize:11, color: syncMsg.type==="ok"?"#16a34a":"#dc2626" }}>
              {syncMsg.text}
            </div>
          )}
        </div>
      )}

      {/* 履歴パネル */}
      {showHistory && (
        <div style={{ background:"#fff", borderBottom:"1px solid #e2e8f0", padding:"12px 20px" }}>
          <div style={{ fontSize:10, color:"#94a3b8", letterSpacing:2, textTransform:"uppercase", marginBottom:10 }}>Week History</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
            {sortedWeeks.map(([id, w]) => {
              const wMin = Object.values(w.events).flat().reduce((s,e) =>
                s + (timeToFrac(e.endTime)-timeToFrac(e.startTime))*60, 0);
              const isCur = id === currentId;
              return (
                <div key={id} style={{ display:"flex", alignItems:"center", gap:6, background: isCur?"#eff6ff":"#f8fafc", border:`1px solid ${isCur?"#93c5fd":"#e2e8f0"}`, borderRadius:7, padding:"6px 12px" }}>
                  <button onClick={() => switchWeek(id)}
                    style={{ ...B, background:"none", color: isCur?"#1d4ed8":"#475569", fontSize:12, fontWeight: isCur?700:400, padding:0 }}>
                    {(w.dateFrom&&w.dateTo) ? `${w.dateFrom}〜${w.dateTo}` : w.label || `Week-${id.slice(-4)}`}
                  </button>
                  <span style={{ fontSize:10, color:"#94a3b8" }}>{(wMin/60).toFixed(1)}h</span>
                  <button onClick={() => { setPdfTarget(id); setPdfModal(true); }}
                    style={{ ...B, background:"none", color:"#c2410c", fontSize:10, padding:"0 2px" }} title="PDF出力">↓</button>
                  {isCur
                    ? <span style={{ fontSize:9, color:"#3b82f6" }}>●</span>
                    : <button onClick={() => deleteWeek(id)} style={{ ...B, background:"none", color:"#fca5a5", fontSize:14, padding:"0 2px", lineHeight:1 }}>×</button>
                  }
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* スケジュール */}
      {activeTab === "schedule" && (
        <div style={{ overflowX:"auto" }}>
          <div style={{ minWidth:700, padding:"0 8px 24px" }}>
            <div style={{ display:"flex", marginLeft:TIME_COL_W, borderBottom:"1px solid #e2e8f0", background:"#fff" }}>
              {DAYS.map((day,i) => {
                const dayMin = events[day].reduce((s,e) => s+(timeToFrac(e.endTime)-timeToFrac(e.startTime))*60, 0);
                const tgt = dayTargetMin[day] || 0;
                const dayProg = tgt > 0 ? Math.min(dayMin/tgt, 1) : 0;
                return (
                  <div key={day} style={{ flex:1, textAlign:"center", padding:"8px 4px 6px", fontSize:11, letterSpacing:1, color: i>=5?"#d97706":"#64748b", textTransform:"uppercase", fontWeight:600 }}>
                    <div>{DAY_JA[i]} <span style={{ fontSize:9, color:"#cbd5e1", fontWeight:400 }}>{day.slice(0,3)}</span></div>
                    <div style={{ display:"flex", alignItems:"center", gap:3, justifyContent:"center", marginTop:4 }}>
                      <input
                        type="number"
                        value={tgt > 0 ? (tgt/60).toFixed(1) : ""}
                        placeholder="—"
                        step="0.5"
                        min="0"
                        onClick={e => e.stopPropagation()}
                        onChange={e => updateStore({ dayTargetMin: { ...dayTargetMin, [day]: Math.round(Number(e.target.value) * 60) } })}
                        style={{ width:36, fontSize:9, textAlign:"center", background:"#f8fafc", border:"1px solid #e2e8f0", borderRadius:3, padding:"1px 2px", color:"#64748b", fontFamily:"inherit" }}
                      />
                      <span style={{ fontSize:8, color:"#cbd5e1" }}>h</span>
                    </div>
                    {tgt > 0 && (
                      <div style={{ margin:"3px 6px 0", height:3, background:"#e2e8f0", borderRadius:2, overflow:"hidden" }}>
                        <div style={{ width:`${dayProg*100}%`, height:"100%", background: dayProg>=1?"#16a34a":"#3b82f6", borderRadius:2, transition:"width 0.3s" }} />
                      </div>
                    )}
                    {tgt > 0 && (
                      <div style={{ fontSize:8, color: dayProg>=1?"#16a34a":"#94a3b8", marginTop:2 }}>
                        {(dayMin/60).toFixed(1)}/{(tgt/60).toFixed(1)}h
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ display:"flex" }}>
              <div style={{ width:TIME_COL_W, flexShrink:0, background:"#fff", borderRight:"1px solid #e2e8f0" }}>
                {HOURS.map(h => (
                  <div key={h} style={{ height:SLOT_HEIGHT, display:"flex", alignItems:"flex-start", justifyContent:"flex-end", paddingRight:8, paddingTop:3, color:"#cbd5e1", fontSize:10 }}>{h}:00</div>
                ))}
              </div>
              {DAYS.map((day, di) => (
                <div key={day} onClick={e => handleGridClick(day,e)}
                  style={{ flex:1, height:HOURS.length*SLOT_HEIGHT, position:"relative", borderLeft:"1px solid #f1f5f9", cursor:"crosshair", background: di%2===0?"#fff":"#fafbfc" }}>
                  {HOURS.map((h,hi) => (
                    <div key={h} style={{ position:"absolute", top:hi*SLOT_HEIGHT, left:0, right:0, borderTop: h%3===0?"1px solid #e2e8f0":"1px solid #f1f5f9", pointerEvents:"none" }} />
                  ))}
                  {events[day].map(ev => {
                    const s = timeToFrac(ev.startTime), en = timeToFrac(ev.endTime);
                    const top = (s-4)*SLOT_HEIGHT;
                    const height = Math.max((en-s)*SLOT_HEIGHT-2, 16);
                    const col = catColors[ev.category]||colorSet('#94a3b8');
                    return (
                      <div key={ev.id} onClick={e => handleEventClick(day,ev,e)}
                        style={{ position:"absolute", top:top+1, left:2, right:2, height, background:col.bg, borderLeft:`3px solid ${col.border}`, borderRadius:4, padding:"3px 5px", overflow:"hidden", cursor:"pointer", zIndex:1, boxShadow:"0 1px 2px rgba(0,0,0,0.06)" }}>
                        <div style={{ fontSize:10, fontWeight:700, color:col.text, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{ev.title}</div>
                        {height>28 && <div style={{ fontSize:9, color:col.border, opacity:0.7 }}>{ev.startTime}–{ev.endTime}</div>}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Reflection */}
      {activeTab === "reflection" && (
        <div style={{ padding:"20px 24px", maxWidth:860 }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:16 }}>
            {DAYS.map((day,i) => {
              const r = reflections[day];
              const tasks = r.tasks || [];
              const mins = events[day].reduce((s,e) => s+(timeToFrac(e.endTime)-timeToFrac(e.startTime))*60, 0);
              const doneCount = tasks.filter(t=>t.done).length;

              function updateR(patch) {
                updateStore({ reflections:{ ...reflections, [day]:{ ...r, ...patch } } });
              }
              function addTask() {
                updateR({ tasks: [...tasks, { id: Date.now(), text: "", done: false }] });
              }
              function updateTask(id, patch) {
                updateR({ tasks: tasks.map(t => t.id===id ? { ...t, ...patch } : t) });
              }
              function deleteTask(id) {
                updateR({ tasks: tasks.filter(t => t.id!==id) });
              }

              return (
                <div key={day} style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:8, padding:14, boxShadow:"0 1px 3px rgba(0,0,0,0.04)" }}>
                  {/* ヘッダー */}
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
                    <span style={{ fontSize:11, color: i>=5?"#d97706":"#475569", letterSpacing:2, textTransform:"uppercase", fontWeight:600 }}>{DAY_JA[i]} {day}</span>
                    <span style={{ fontSize:11, color:"#3b82f6", fontWeight:700 }}>{(mins/60).toFixed(1)}h</span>
                  </div>
                  {/* Mark */}
                  <div style={{ display:"flex", gap:6, marginBottom:8 }}>
                    <span style={{ fontSize:10, color:"#94a3b8", paddingTop:5 }}>Mark</span>
                    <select value={r.mark} onChange={e => updateR({ mark:e.target.value })}
                      style={{ flex:1, background:"#f8fafc", border:"1px solid #e2e8f0", color:"#0f172a", borderRadius:5, padding:"3px 6px", fontSize:11, fontFamily:"inherit" }}>
                      <option value="">—</option>
                      {["◎ 完璧","○ 良好","△ 普通","✕ 不足"].map(m => <option key={m}>{m}</option>)}
                    </select>
                  </div>
                  {/* 2カラム：Reflection | Tasks */}
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                    {/* Reflection */}
                    <div>
                      <div style={{ fontSize:9, color:"#94a3b8", letterSpacing:1, textTransform:"uppercase", marginBottom:4 }}>Reflection</div>
                      <textarea placeholder="振り返り..." value={r.reflection}
                        onChange={e => updateR({ reflection:e.target.value })}
                        style={{ width:"100%", minHeight:72, background:"#f8fafc", border:"1px solid #e2e8f0", color:"#334155", borderRadius:5, padding:"6px 8px", fontSize:11, resize:"vertical", fontFamily:"inherit", boxSizing:"border-box" }} />
                    </div>
                    {/* Tasks */}
                    <div>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
                        <div style={{ fontSize:9, color:"#94a3b8", letterSpacing:1, textTransform:"uppercase" }}>
                          Tasks {tasks.length>0 && <span style={{ color: doneCount===tasks.length?"#16a34a":"#94a3b8" }}>{doneCount}/{tasks.length}</span>}
                        </div>
                        <button onClick={addTask}
                          style={{ border:"none", cursor:"pointer", background:"#eff6ff", color:"#3b82f6", borderRadius:4, width:18, height:18, fontSize:14, lineHeight:"16px", textAlign:"center", padding:0, fontFamily:"inherit", fontWeight:700 }}>+</button>
                      </div>
                      <div style={{ display:"flex", flexDirection:"column", gap:4, minHeight:72 }}>
                        {tasks.length === 0 && (
                          <div style={{ fontSize:10, color:"#cbd5e1", paddingTop:4 }}>＋ でタスクを追加</div>
                        )}
                        {tasks.map(task => (
                          <div key={task.id} style={{ display:"flex", alignItems:"center", gap:5 }}>
                            <input type="checkbox" checked={task.done} onChange={e => updateTask(task.id, { done:e.target.checked })}
                              style={{ flexShrink:0, accentColor:"#3b82f6", width:13, height:13, cursor:"pointer" }} />
                            <input type="text" value={task.text}
                              onChange={e => updateTask(task.id, { text:e.target.value })}
                              placeholder="タスク名..."
                              style={{ flex:1, fontSize:11, color: task.done?"#94a3b8":"#334155", textDecoration: task.done?"line-through":"none", background:"transparent", border:"none", borderBottom:"1px solid #f1f5f9", outline:"none", fontFamily:"inherit", padding:"1px 2px" }} />
                            <button onClick={() => deleteTask(task.id)}
                              style={{ border:"none", background:"none", cursor:"pointer", color:"#e2e8f0", fontSize:13, padding:0, lineHeight:1 }}>×</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:8, padding:14, boxShadow:"0 1px 3px rgba(0,0,0,0.04)" }}>
            <div style={{ fontSize:11, color:"#94a3b8", letterSpacing:2, textTransform:"uppercase", marginBottom:8 }}>Week Reflection</div>
            <textarea placeholder="週次振り返り..." value={weekNote}
              onChange={e => updateStore({ weekNote:e.target.value })}
              style={{ width:"100%", minHeight:80, background:"#f8fafc", border:"1px solid #e2e8f0", color:"#334155", borderRadius:5, padding:"6px 8px", fontSize:11, resize:"vertical", fontFamily:"inherit", boxSizing:"border-box" }} />
          </div>
        </div>
      )}

      {/* PDF出力モーダル */}
      {pdfModal && (
        <div onClick={() => setPdfModal(false)} style={{ position:"fixed", inset:0, background:"rgba(15,23,42,0.3)", zIndex:200, display:"flex", alignItems:"center", justifyContent:"center" }}>
          <div onClick={e => e.stopPropagation()} style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:10, padding:24, width:360, boxShadow:"0 20px 50px rgba(0,0,0,0.12)" }}>
            <div style={{ fontSize:11, color:"#94a3b8", letterSpacing:2, textTransform:"uppercase", marginBottom:16 }}>PDF出力 — 週を選択</div>
            <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:20, maxHeight:300, overflowY:"auto" }}>
              {sortedWeeks.map(([id, w]) => {
                const wMin = Object.values(w.events).flat().reduce((s,e) =>
                  s + (timeToFrac(e.endTime)-timeToFrac(e.startTime))*60, 0);
                const isSelected = pdfTarget === id;
                return (
                  <div key={id} onClick={() => setPdfTarget(id)}
                    style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 14px", borderRadius:7, border:`1px solid ${isSelected?"#3b82f6":"#e2e8f0"}`, background: isSelected?"#eff6ff":"#f8fafc", cursor:"pointer" }}>
                    <span style={{ fontSize:13, fontWeight: isSelected?700:400, color: isSelected?"#1d4ed8":"#334155" }}>{(w.dateFrom&&w.dateTo) ? `${w.dateFrom}〜${w.dateTo}` : w.label || `Week-${id.slice(-4)}`}</span>
                    <span style={{ fontSize:11, color:"#94a3b8" }}>{(wMin/60).toFixed(1)}h</span>
                  </div>
                );
              })}
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={() => pdfTarget && executePrint(pdfTarget)}
                style={{ ...B, flex:1, padding:"9px 0", background: pdfTarget?"#c2410c":"#e2e8f0", borderRadius:6, color: pdfTarget?"#fff":"#94a3b8", fontSize:11, letterSpacing:1, textTransform:"uppercase", cursor: pdfTarget?"pointer":"default" }}>
                印刷 / PDF保存
              </button>
              <button onClick={() => setPdfModal(false)}
                style={{ ...B, padding:"9px 14px", background:"#f8fafc", border:"1px solid #e2e8f0", borderRadius:6, color:"#94a3b8", fontSize:11 }}>
                キャンセル
              </button>
            </div>
            <div style={{ fontSize:10, color:"#94a3b8", marginTop:10 }}>HTMLファイルがダウンロードされます。ブラウザで開き、Ctrl+P（Mac: ⌘+P）→「PDFとして保存」で保存できます。</div>
          </div>
        </div>
      )}

      {/* イベントモーダル */}
      {modal && (
        <div onClick={() => setModal(null)} style={{ position:"fixed", inset:0, background:"rgba(15,23,42,0.3)", zIndex:100, display:"flex", alignItems:"center", justifyContent:"center" }}>
          <div onClick={e => e.stopPropagation()} style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:10, padding:24, width:320, boxShadow:"0 20px 50px rgba(0,0,0,0.12)" }}>
            <div style={{ fontSize:11, color:"#94a3b8", letterSpacing:2, textTransform:"uppercase", marginBottom:16 }}>
              {modal.mode==="new"?"New Event":"Edit Event"} — {modal.day}
            </div>
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:10, color:"#94a3b8", marginBottom:3, textTransform:"uppercase", letterSpacing:1 }}>Title</div>
              <input autoFocus type="text" value={form.title} onChange={e => setForm(p=>({...p,title:e.target.value}))}
                style={{ ...inputBase }} />
            </div>
            <div style={{ display:"flex", gap:8, marginBottom:10 }}>
              {["startTime","endTime"].map(key => (
                <div key={key} style={{ flex:1 }}>
                  <div style={{ fontSize:10, color:"#94a3b8", marginBottom:3, textTransform:"uppercase", letterSpacing:1 }}>{key==="startTime"?"Start":"End"}</div>
                  <input type="time" value={form[key]} onChange={e => setForm(p=>({...p,[key]:e.target.value}))}
                    style={{ ...inputBase }} />
                </div>
              ))}
            </div>
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:10, color:"#94a3b8", marginBottom:3, textTransform:"uppercase", letterSpacing:1 }}>Category</div>
              <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                {categories.map(({name:cat}) => {
                  const col = catColors[cat]||colorSet('#94a3b8');
                  return (
                    <button key={cat} onClick={() => setForm(p=>({...p,category:cat}))}
                      style={{ ...B, padding:"4px 10px", borderRadius:5, border:`1px solid ${form.category===cat?col.border:"#e2e8f0"}`, background: form.category===cat?col.bg:"#f8fafc", color: form.category===cat?col.text:"#94a3b8", fontSize:10, fontFamily:"inherit" }}>
                      {cat}
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:10, color:"#94a3b8", marginBottom:3, textTransform:"uppercase", letterSpacing:1 }}>Note</div>
              <textarea value={form.note} onChange={e => setForm(p=>({...p,note:e.target.value}))}
                style={{ ...inputBase, minHeight:48, resize:"vertical" }} />
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={saveEvent}
                style={{ ...B, flex:1, padding:"8px 0", background:"#3b82f6", borderRadius:6, color:"#fff", fontSize:11, letterSpacing:1, textTransform:"uppercase" }}>Save</button>
              {modal.mode==="edit" && (
                <button onClick={deleteEvent}
                  style={{ ...B, padding:"8px 14px", background:"#fef2f2", border:"1px solid #fecaca", borderRadius:6, color:"#dc2626", fontSize:11 }}>Delete</button>
              )}
              <button onClick={() => setModal(null)}
                style={{ ...B, padding:"8px 14px", background:"#f8fafc", border:"1px solid #e2e8f0", borderRadius:6, color:"#94a3b8", fontSize:11 }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* カテゴリ設定モーダル */}
      {catModal && (
        <div onClick={() => setCatModal(false)} style={{ position:"fixed", inset:0, background:"rgba(15,23,42,0.3)", zIndex:300, display:"flex", alignItems:"center", justifyContent:"center" }}>
          <div onClick={e => e.stopPropagation()} style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:12, padding:24, width:340, maxHeight:"80vh", overflowY:"auto", boxShadow:"0 24px 60px rgba(0,0,0,0.15)" }}>
            <div style={{ fontSize:10, color:"#94a3b8", letterSpacing:2, textTransform:"uppercase", marginBottom:16 }}>🎨 カテゴリ設定</div>
            <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:16 }}>
              {categories.map((cat, idx) => (
                <div key={idx} style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <input type="color" value={cat.color}
                    onChange={e => {
                      const nc = [...categories];
                      nc[idx] = { ...nc[idx], color: e.target.value };
                      updateCategories(nc);
                    }}
                    style={{ width:32, height:32, border:"1px solid #e2e8f0", borderRadius:6, cursor:"pointer", padding:2 }} />
                  <input type="text" value={cat.name}
                    onChange={e => {
                      const nc = [...categories];
                      nc[idx] = { ...nc[idx], name: e.target.value };
                      updateCategories(nc);
                    }}
                    style={{ flex:1, fontSize:13, background:"#f8fafc", border:"1px solid #e2e8f0", borderRadius:5, padding:"6px 10px", fontFamily:"inherit", color:"#0f172a" }} />
                  <button onClick={() => {
                      if (categories.length <= 1) return;
                      updateCategories(categories.filter((_,i) => i!==idx));
                    }}
                    style={{ border:"none", background:"none", cursor:"pointer", color:"#fca5a5", fontSize:16, padding:"0 4px" }}>×</button>
                </div>
              ))}
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={() => updateCategories([...categories, { name:"New", color:"#64748b" }])}
                style={{ ...B, flex:1, padding:"8px 0", background:"#f8fafc", border:"1px solid #e2e8f0", borderRadius:6, color:"#475569", fontSize:11 }}>
                + カテゴリ追加
              </button>
              <button onClick={() => { updateCategories(DEFAULT_CATS); }}
                style={{ ...B, padding:"8px 12px", background:"#f8fafc", border:"1px solid #e2e8f0", borderRadius:6, color:"#94a3b8", fontSize:11 }}>
                リセット
              </button>
              <button onClick={() => setCatModal(false)}
                style={{ ...B, padding:"8px 14px", background:"#0f172a", borderRadius:6, color:"#fff", fontSize:11 }}>
                完了
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AIフィードバックモーダル */}
      {aiModal && (
        <div onClick={() => setAiModal(false)} style={{ position:"fixed", inset:0, background:"rgba(15,23,42,0.4)", zIndex:300, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:12, padding:28, width:"100%", maxWidth:580, maxHeight:"85vh", overflowY:"auto", boxShadow:"0 24px 60px rgba(0,0,0,0.15)" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
              <div>
                <div style={{ fontSize:10, color:"#a21caf", letterSpacing:2, textTransform:"uppercase", marginBottom:2 }}>✦ AI フィードバック</div>
                <div style={{ fontSize:15, fontWeight:700, color:"#0f172a" }}>{dateFrom ? `${dateFrom}〜${dateTo}` : "今週"}</div>
              </div>
              <button onClick={() => setAiModal(false)} style={{ border:"none", background:"none", cursor:"pointer", fontSize:18, color:"#94a3b8" }}>✕</button>
            </div>

            {!aiFeedback && !aiLoading && (
              <div style={{ textAlign:"center", padding:"32px 0" }}>
                <div style={{ fontSize:12, color:"#64748b", marginBottom:20, lineHeight:1.7 }}>
                  現在表示中の週のデータ（スケジュール・Reflection・達成率）を<br/>もとにAIがフィードバックを生成します。
                </div>
                <button onClick={generateFeedback}
                  style={{ border:"none", cursor:"pointer", fontFamily:"inherit", padding:"10px 28px", background:"#a21caf", borderRadius:7, color:"#fff", fontSize:12, letterSpacing:1, textTransform:"uppercase" }}>
                  フィードバックを生成
                </button>
              </div>
            )}

            {aiLoading && (
              <div style={{ textAlign:"center", padding:"40px 0" }}>
                <div style={{ fontSize:13, color:"#a21caf", marginBottom:8 }}>分析中...</div>
                <div style={{ fontSize:11, color:"#94a3b8" }}>週データをAIが解析しています</div>
              </div>
            )}

            {aiFeedback && !aiLoading && (
              <div>
                <div style={{ fontSize:11, color:"#94a3b8", marginBottom:16 }}>
                  生成日時: {new Date(aiFeedback.createdAt).toLocaleString("ja-JP")}
                </div>
                <div style={{ fontSize:12, color:"#1e293b", lineHeight:1.85, whiteSpace:"pre-wrap", background:"#f8fafc", border:"1px solid #e2e8f0", borderRadius:8, padding:18 }}>
                  {aiFeedback.text}
                </div>
                <div style={{ display:"flex", gap:8, marginTop:16 }}>
                  <button onClick={generateFeedback}
                    style={{ cursor:"pointer", fontFamily:"inherit", padding:"8px 18px", background:"#f8fafc", border:"1px solid #e2e8f0", borderRadius:6, color:"#475569", fontSize:11 }}>
                    再生成
                  </button>
                  <button onClick={() => setAiModal(false)}
                    style={{ border:"none", cursor:"pointer", fontFamily:"inherit", padding:"8px 18px", background:"#a21caf", borderRadius:6, color:"#fff", fontSize:11 }}>
                    閉じる
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 凡例 */}
      <div style={{ padding:"8px 20px 14px", display:"flex", gap:12, flexWrap:"wrap", borderTop:"1px solid #f1f5f9", background:"#fff" }}>
        {categories.map(({name:cat}) => {
          const col = catColors[cat]||colorSet('#94a3b8');
          return (
            <div key={cat} style={{ display:"flex", alignItems:"center", gap:4 }}>
              <div style={{ width:8, height:8, background:col.border, borderRadius:2 }} />
              <span style={{ fontSize:10, color:"#94a3b8" }}>{cat}</span>
            </div>
          );
        })}
        <span style={{ fontSize:10, color:"#e2e8f0", marginLeft:"auto" }}>Click grid to add · Click block to edit</span>
      </div>
    </div>
  );
}
