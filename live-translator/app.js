/* ============================================================
   مترجم فدفدة الفوري — Live Caption Translator
   - مصدر المايك: تعرّف مجاني عبر Web Speech API
   - مصدر التبويب/النظام: تفريغ عبر OpenAI Whisper (يتطلب مفتاح)
   - الترجمة: مجانية (Google/MyMemory) أو احترافية (OpenAI)
   ============================================================ */

(() => {
  "use strict";

  /* ---------- DOM ---------- */
  const $ = (id) => document.getElementById(id);
  const els = {
    sourceSeg: $("sourceSeg"),
    sourceHint: $("sourceHint"),
    engineSelect: $("engineSelect"),
    srcLang: $("srcLang"),
    dstLang: $("dstLang"),
    startBtn: $("startBtn"),
    stopBtn: $("stopBtn"),
    status: $("status"),
    fontSize: $("fontSize"),
    fontSizeVal: $("fontSizeVal"),
    textColor: $("textColor"),
    bgColor: $("bgColor"),
    bgOpacity: $("bgOpacity"),
    opacityVal: $("opacityVal"),
    showOriginal: $("showOriginal"),
    autoScroll: $("autoScroll"),
    captionPos: $("captionPos"),
    fullscreenBtn: $("fullscreenBtn"),
    exportTxt: $("exportTxt"),
    exportSrt: $("exportSrt"),
    clearBtn: $("clearBtn"),
    captionBox: $("captionBox"),
    captionEmpty: $("captionEmpty"),
    captionLines: $("captionLines"),
    captionInterim: $("captionInterim"),
    captionStage: $("captionStage"),
    recDot: $("recDot"),
    extraToggle: $("extraToggle"),
    extraPanel: $("extraPanel"),
    elapsed: $("elapsed"),
    wordCount: $("wordCount"),
    engineUsed: $("engineUsed"),
    notesArea: $("notesArea"),
    themeBtn: $("themeBtn"),
    settingsBtn: $("settingsBtn"),
    settingsModal: $("settingsModal"),
    closeSettings: $("closeSettings"),
    saveSettings: $("saveSettings"),
    apiKey: $("apiKey"),
    apiModel: $("apiModel"),
    professionalTone: $("professionalTone"),
  };

  /* ---------- State ---------- */
  const state = {
    source: "mic",
    running: false,
    recognition: null,      // Web Speech
    mediaRecorder: null,    // tab/system audio
    mediaStream: null,
    history: [],            // {orig, trans, start, end}
    startTime: 0,
    timerId: null,
    wordCount: 0,
  };

  const LS = {
    get: (k, d) => { try { const v = localStorage.getItem("ft_" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem("ft_" + k, JSON.stringify(v)); } catch {} },
  };

  /* ============================================================
     TRANSLATION ENGINES
     ============================================================ */

  async function translate(text, from, to) {
    if (!text || !text.trim()) return "";
    const engine = els.engineSelect.value;
    const key = LS.get("apiKey", "");

    if (engine === "openai" || (engine === "auto" && key)) {
      try {
        const r = await translateOpenAI(text, from, to, key);
        setEngineUsed("OpenAI");
        return r;
      } catch (e) {
        if (engine === "openai") throw e;
        // fall through to free
      }
    }
    // Free path
    try {
      const r = await translateGoogle(text, from, to);
      setEngineUsed("Google (مجاني)");
      return r;
    } catch (e) {
      const r = await translateMyMemory(text, from, to);
      setEngineUsed("MyMemory (مجاني)");
      return r;
    }
  }

  // Unofficial Google endpoint (CORS-friendly with client=gtx)
  async function translateGoogle(text, from, to) {
    const sl = from.split("-")[0];
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${to}&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("google " + res.status);
    const data = await res.json();
    return (data[0] || []).map((seg) => seg[0]).join("");
  }

  // MyMemory free API (fallback)
  async function translateMyMemory(text, from, to) {
    const sl = from.split("-")[0];
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${sl}|${to}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("mymemory " + res.status);
    const data = await res.json();
    return data.responseData?.translatedText || text;
  }

  async function translateOpenAI(text, from, to, key) {
    if (!key) throw new Error("no-key");
    const model = LS.get("apiModel", "gpt-4o-mini");
    const pro = LS.get("professionalTone", true);
    const langName = { ar: "Arabic", en: "English", fr: "French", es: "Spanish", tr: "Turkish" }[to] || to;
    const sys = pro
      ? `You are a professional translator. Translate the user's text into fluent, natural ${langName}. Preserve meaning and tone. Output ONLY the translation, no notes.`
      : `Translate the user's text into ${langName}. Output ONLY the translation.`;
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [{ role: "system", content: sys }, { role: "user", content: text }],
      }),
    });
    if (!res.ok) throw new Error("openai " + res.status);
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || text;
  }

  // Whisper transcription for captured audio chunks
  async function transcribeWhisper(blob, lang, key) {
    const fd = new FormData();
    fd.append("file", blob, "audio.webm");
    fd.append("model", "whisper-1");
    fd.append("language", lang.split("-")[0]);
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: "Bearer " + key },
      body: fd,
    });
    if (!res.ok) throw new Error("whisper " + res.status);
    const data = await res.json();
    return data.text?.trim() || "";
  }

  /* ============================================================
     CAPTION RENDERING
     ============================================================ */

  function setStatus(msg, type = "idle") {
    els.status.textContent = msg;
    els.status.className = "status " + type;
  }
  function setEngineUsed(name) { els.engineUsed.textContent = name; }

  function hideEmpty() { els.captionEmpty.hidden = true; }

  function showInterim(origText) {
    els.captionInterim.textContent = origText;
  }

  async function commitLine(origText) {
    if (!origText.trim()) return;
    hideEmpty();
    els.captionInterim.textContent = "";
    const from = els.srcLang.value;
    const to = els.dstLang.value;

    // Placeholder line while translating
    const line = document.createElement("div");
    line.className = "cap-line";
    if (els.showOriginal.checked) {
      const o = document.createElement("span");
      o.className = "orig";
      o.textContent = origText;
      line.appendChild(o);
    }
    const t = document.createElement("span");
    t.className = "trans";
    t.textContent = "…";
    line.appendChild(t);
    els.captionLines.appendChild(line);
    autoScroll();

    const start = (Date.now() - state.startTime) / 1000;
    try {
      const translated = await translate(origText, from, to);
      t.textContent = translated;
      state.history.push({ orig: origText, trans: translated, start, end: (Date.now() - state.startTime) / 1000 });
      state.wordCount += origText.trim().split(/\s+/).length;
      els.wordCount.textContent = state.wordCount;
    } catch (e) {
      t.textContent = "⚠️ تعذرت الترجمة";
      console.error(e);
    }
    trimLines();
    autoScroll();
  }

  function trimLines() {
    while (els.captionLines.children.length > 60) {
      els.captionLines.removeChild(els.captionLines.firstChild);
    }
  }
  function autoScroll() {
    if (els.autoScroll.checked) els.captionBox.scrollTop = els.captionBox.scrollHeight;
  }

  /* ============================================================
     SOURCE 1: MICROPHONE (Web Speech API — free)
     ============================================================ */

  function startMic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setStatus("متصفحك لا يدعم التعرّف المجاني على الكلام. استخدم Chrome أو أدخل مفتاح API.", "error");
      return false;
    }
    const rec = new SR();
    rec.lang = els.srcLang.value;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (ev) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        if (res.isFinal) commitLine(res[0].transcript);
        else interim += res[0].transcript;
      }
      if (interim) showInterim(interim);
    };
    rec.onerror = (ev) => {
      if (ev.error === "no-speech" || ev.error === "aborted") return;
      if (ev.error === "not-allowed") setStatus("تم رفض إذن المايك.", "error");
      else setStatus("خطأ في التعرّف: " + ev.error, "error");
    };
    rec.onend = () => {
      if (state.running) { try { rec.start(); } catch {} } // auto-restart
    };
    try { rec.start(); } catch (e) { setStatus("تعذّر بدء المايك.", "error"); return false; }
    state.recognition = rec;
    setStatus("🎤 الترجمة الفورية تعمل (المايك)…", "live");
    return true;
  }

  function stopMic() {
    if (state.recognition) {
      state.recognition.onend = null;
      try { state.recognition.stop(); } catch {}
      state.recognition = null;
    }
  }

  /* ============================================================
     SOURCE 2: TAB / SYSTEM AUDIO (Whisper — needs key)
     ============================================================ */

  async function startTab() {
    const key = LS.get("apiKey", "");
    if (!key) {
      setStatus("صوت التبويب/النظام يحتاج مفتاح OpenAI API (من الإعدادات ⚙️).", "error");
      return false;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (e) {
      setStatus("تم إلغاء مشاركة الشاشة/التبويب.", "error");
      return false;
    }
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      stream.getTracks().forEach((t) => t.stop());
      setStatus("لم يتم التقاط صوت. اختر «مشاركة صوت التبويب/النظام» عند الطلب.", "error");
      return false;
    }
    // We only need audio
    stream.getVideoTracks().forEach((t) => t.stop());
    const audioStream = new MediaStream(audioTracks);
    state.mediaStream = stream;

    const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
    const rec = new MediaRecorder(audioStream, mime ? { mimeType: mime } : undefined);
    state.mediaRecorder = rec;

    rec.ondataavailable = async (ev) => {
      if (!ev.data || ev.data.size < 2000) return;
      try {
        setStatus("🖥️ يجري التفريغ والترجمة…", "working");
        const text = await transcribeWhisper(ev.data, els.srcLang.value, key);
        if (text) await commitLine(text);
        if (state.running) setStatus("🖥️ الترجمة الفورية تعمل (صوت التبويب)…", "live");
      } catch (e) {
        console.error(e);
        setStatus("خطأ في التفريغ (تحقق من المفتاح/الرصيد).", "error");
      }
    };
    // chunk every 4s for near-realtime
    rec.start();
    state.chunkTimer = setInterval(() => {
      if (rec.state === "recording") { rec.stop(); rec.start(); }
    }, 4000);

    // If user stops sharing from browser UI
    audioTracks[0].addEventListener("ended", () => stopAll());

    setStatus("🖥️ الترجمة الفورية تعمل (صوت التبويب)…", "live");
    return true;
  }

  function stopTab() {
    if (state.chunkTimer) { clearInterval(state.chunkTimer); state.chunkTimer = null; }
    if (state.mediaRecorder) { try { state.mediaRecorder.stop(); } catch {} state.mediaRecorder = null; }
    if (state.mediaStream) { state.mediaStream.getTracks().forEach((t) => t.stop()); state.mediaStream = null; }
  }

  /* ============================================================
     START / STOP ORCHESTRATION
     ============================================================ */

  async function startAll() {
    if (state.running) return;
    state.running = true;
    els.startBtn.hidden = true;
    els.stopBtn.hidden = false;
    els.recDot.classList.add("on");
    state.startTime = Date.now();
    startTimer();

    let ok;
    if (state.source === "mic") ok = startMic();
    else ok = await startTab();

    if (!ok) stopAll();
  }

  function stopAll() {
    state.running = false;
    stopMic();
    stopTab();
    stopTimer();
    els.startBtn.hidden = false;
    els.stopBtn.hidden = true;
    els.recDot.classList.remove("on");
    els.captionInterim.textContent = "";
    setStatus("تم الإيقاف.", "idle");
  }

  function startTimer() {
    state.timerId = setInterval(() => {
      const s = Math.floor((Date.now() - state.startTime) / 1000);
      const m = String(Math.floor(s / 60)).padStart(2, "0");
      const ss = String(s % 60).padStart(2, "0");
      els.elapsed.textContent = `${m}:${ss}`;
    }, 1000);
  }
  function stopTimer() { if (state.timerId) { clearInterval(state.timerId); state.timerId = null; } }

  /* ============================================================
     DISPLAY OPTIONS
     ============================================================ */

  function applyDisplay() {
    const size = els.fontSize.value;
    const color = els.textColor.value;
    const bg = els.bgColor.value;
    const op = els.bgOpacity.value / 100;
    els.fontSizeVal.textContent = size;
    els.opacityVal.textContent = els.bgOpacity.value;
    const rgba = hexToRgba(bg, op);
    els.captionBox.style.setProperty("--cap-size", size + "px");
    els.captionBox.style.setProperty("--cap-color", color);
    els.captionBox.style.setProperty("--cap-bg", rgba);
    els.captionStage.style.setProperty("--fs-bg", hexToRgba(bg, 1));
    els.captionBox.dataset.pos = els.captionPos.value;
    saveDisplay();
  }

  function hexToRgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  function saveDisplay() {
    LS.set("display", {
      fontSize: els.fontSize.value, textColor: els.textColor.value,
      bgColor: els.bgColor.value, bgOpacity: els.bgOpacity.value,
      showOriginal: els.showOriginal.checked, autoScroll: els.autoScroll.checked,
      captionPos: els.captionPos.value, engine: els.engineSelect.value,
      srcLang: els.srcLang.value, dstLang: els.dstLang.value,
    });
  }
  function loadDisplay() {
    const d = LS.get("display", null);
    if (!d) return;
    els.fontSize.value = d.fontSize ?? 42;
    els.textColor.value = d.textColor ?? "#ffffff";
    els.bgColor.value = d.bgColor ?? "#000000";
    els.bgOpacity.value = d.bgOpacity ?? 70;
    els.showOriginal.checked = !!d.showOriginal;
    els.autoScroll.checked = d.autoScroll !== false;
    els.captionPos.value = d.captionPos ?? "bottom";
    els.engineSelect.value = d.engine ?? "auto";
    if (d.srcLang) els.srcLang.value = d.srcLang;
    if (d.dstLang) els.dstLang.value = d.dstLang;
  }

  /* ============================================================
     EXPORT
     ============================================================ */

  function download(name, content, type = "text/plain") {
    const blob = new Blob([content], { type: type + ";charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function exportTxt() {
    if (!state.history.length) return setStatus("لا يوجد سجل للتصدير.", "error");
    const txt = state.history.map((h) => `${h.orig}\n${h.trans}\n`).join("\n");
    download("fadfada-translation.txt", txt);
  }
  function exportSrt() {
    if (!state.history.length) return setStatus("لا يوجد سجل للتصدير.", "error");
    const fmt = (s) => {
      const h = String(Math.floor(s / 3600)).padStart(2, "0");
      const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
      const sec = String(Math.floor(s % 60)).padStart(2, "0");
      const ms = String(Math.floor((s % 1) * 1000)).padStart(3, "0");
      return `${h}:${m}:${sec},${ms}`;
    };
    const srt = state.history.map((h, i) =>
      `${i + 1}\n${fmt(h.start)} --> ${fmt(h.end)}\n${h.trans}\n`).join("\n");
    download("fadfada-translation.srt", srt);
  }
  function clearHistory() {
    state.history = [];
    state.wordCount = 0;
    els.wordCount.textContent = "0";
    els.captionLines.innerHTML = "";
    els.captionInterim.textContent = "";
    els.captionEmpty.hidden = false;
  }

  /* ============================================================
     EVENT WIRING
     ============================================================ */

  els.sourceSeg.addEventListener("click", (e) => {
    const btn = e.target.closest(".seg-btn");
    if (!btn) return;
    [...els.sourceSeg.children].forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.source = btn.dataset.source;
    els.sourceHint.textContent = state.source === "mic"
      ? "المايك يعمل مجاناً بالكامل عبر متصفحك."
      : "صوت التبويب/النظام يستخدم تفريغ Whisper (يتطلب مفتاح API). عند الطلب فعّل خيار «مشاركة الصوت».";
  });

  els.startBtn.addEventListener("click", startAll);
  els.stopBtn.addEventListener("click", stopAll);

  ["fontSize", "textColor", "bgColor", "bgOpacity", "captionPos"].forEach((id) =>
    els[id].addEventListener("input", applyDisplay));
  ["showOriginal", "autoScroll"].forEach((id) =>
    els[id].addEventListener("change", saveDisplay));
  ["engineSelect", "srcLang", "dstLang"].forEach((id) =>
    els[id].addEventListener("change", saveDisplay));

  els.fullscreenBtn.addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else els.captionStage.requestFullscreen?.();
  });

  els.exportTxt.addEventListener("click", exportTxt);
  els.exportSrt.addEventListener("click", exportSrt);
  els.clearBtn.addEventListener("click", clearHistory);

  els.extraToggle.addEventListener("click", () => {
    els.extraPanel.hidden = !els.extraPanel.hidden;
  });

  els.themeBtn.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme");
    const next = cur === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    LS.set("theme", next);
  });

  // Settings modal
  els.settingsBtn.addEventListener("click", () => {
    els.apiKey.value = LS.get("apiKey", "");
    els.apiModel.value = LS.get("apiModel", "gpt-4o-mini");
    els.professionalTone.checked = LS.get("professionalTone", true);
    els.settingsModal.hidden = false;
  });
  els.closeSettings.addEventListener("click", () => (els.settingsModal.hidden = true));
  els.settingsModal.addEventListener("click", (e) => {
    if (e.target === els.settingsModal) els.settingsModal.hidden = true;
  });
  els.saveSettings.addEventListener("click", () => {
    LS.set("apiKey", els.apiKey.value.trim());
    LS.set("apiModel", els.apiModel.value.trim() || "gpt-4o-mini");
    LS.set("professionalTone", els.professionalTone.checked);
    els.settingsModal.hidden = true;
    setStatus("تم حفظ الإعدادات.", "live");
    setTimeout(() => state.running || setStatus("جاهز.", "idle"), 1500);
  });

  els.notesArea.addEventListener("input", () => LS.set("notes", els.notesArea.value));

  /* ---------- Init ---------- */
  function init() {
    document.documentElement.setAttribute("data-theme", LS.get("theme", "dark"));
    loadDisplay();
    applyDisplay();
    els.notesArea.value = LS.get("notes", "");
    setStatus("جاهز.", "idle");
  }
  init();
})();
