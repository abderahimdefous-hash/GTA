(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const intro = $("intro");
  const app = $("app");
  const stage = document.querySelector(".stage");
  const statusEl = $("status");
  const captionEl = $("caption");
  const logEl = $("log");
  const form = $("form");
  const input = $("input");
  const micBtn = $("micBtn");
  const langSelect = $("langSelect");
  const voiceToggle = $("voiceToggle");

  const TEXT = {
    "ar-MA": {
      greet: "السلام عليكم! أنا Da9awi، الذكاء الاصطناعي ديالك. شنو بغيتي نهضرو عليه اليوم؟",
      welcomeBack: "مرحبا بيك من جديد! فرحان حيت رجعتي. فين وصلنا؟",
      idle: "واجد…", listening: "كنسمعك…", thinking: "كنفكر…", speaking: "كنهضر…",
      placeholder: "كتب شي حاجة ولا ضغط على الميكرو…",
      noMic: "المتصفح ديالك ما كيدعمش الميكرو، جرب Chrome.",
    },
    "fr-FR": {
      greet: "Bonjour ! Je suis Da9awi, ton intelligence artificielle. De quoi veux-tu parler aujourd'hui ?",
      welcomeBack: "Content de te revoir ! On reprend où on en était ?",
      idle: "Prêt…", listening: "Je t'écoute…", thinking: "Je réfléchis…", speaking: "Je parle…",
      placeholder: "Écris quelque chose ou appuie sur le micro…",
      noMic: "Ton navigateur ne supporte pas le micro, essaie Chrome.",
    },
    "en-US": {
      greet: "Hi there! I'm Da9awi, your AI companion. What would you like to talk about today?",
      welcomeBack: "Welcome back! Good to see you again. Where were we?",
      idle: "Ready…", listening: "Listening…", thinking: "Thinking…", speaking: "Speaking…",
      placeholder: "Type something or tap the mic…",
      noMic: "Your browser doesn't support the microphone, try Chrome.",
    },
  };

  let lang = "ar-MA";
  const t = (key) => TEXT[lang][key];
  const history = [];

  /* ================= Memory (what Da9awi learns) ================= */
  // Kept in this browser only, so each visitor has their own Da9awi.

  const MEMORY_KEY = "da9awi.memory";
  const HISTORY_KEY = "da9awi.history";
  const load = (key) => { try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; } };
  const store = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked */ } };
  let memory = load(MEMORY_KEY);

  function learnFrom(raw) {
    const facts = [];
    const text = raw.replace(/\[\[\s*REMEMBER\s*:\s*([\s\S]*?)\]\]/gi, (_, fact) => {
      facts.push(fact.trim());
      return "";
    }).trim();
    for (const fact of facts) {
      if (fact && !memory.includes(fact)) memory.push(fact.slice(0, 300));
    }
    if (facts.length) {
      memory = memory.slice(-50);
      store(MEMORY_KEY, memory);
      renderMemory();
    }
    return text;
  }

  function renderMemory() {
    $("memCount").textContent = memory.length;
    $("memEmpty").hidden = memory.length > 0;
    const list = $("memList");
    list.replaceChildren(...memory.map((f) => Object.assign(document.createElement("li"), { textContent: f })));
  }

  function memoryPrompt() {
    return memory.length
      ? `\n\nWhat you have learned in earlier conversations (use it naturally):\n${memory.map((f) => `- ${f}`).join("\n")}`
      : "";
  }

  /* ================= Face (3D, see face3d.js) ================= */

  const faceState = window.Da9awiFace ? window.Da9awiFace.state : { speaking: false, wordPulse: 0, mode: "idle" };

  function setMode(mode) {
    stage.classList.remove("speaking", "listening", "thinking");
    if (mode !== "idle") stage.classList.add(mode);
    statusEl.textContent = t(mode);
    faceState.mode = mode;
  }

  /* ================= Speech output ================= */

  const synth = window.speechSynthesis;
  let voices = [];
  function loadVoices() { voices = synth ? synth.getVoices() : []; }
  if (synth) {
    loadVoices();
    synth.addEventListener?.("voiceschanged", loadVoices);
  }

  function pickVoice() {
    const base = lang.slice(0, 2);
    return voices.find((v) => v.lang === lang)
      || voices.find((v) => v.lang.toLowerCase().startsWith(base))
      || null;
  }

  function typeCaption(text, durationMs) {
    captionEl.textContent = "";
    const step = Math.max(12, durationMs / Math.max(1, text.length));
    let i = 0;
    clearInterval(typeCaption.timer);
    typeCaption.timer = setInterval(() => {
      captionEl.textContent = text.slice(0, ++i);
      if (i >= text.length) clearInterval(typeCaption.timer);
    }, step);
  }

  function speak(text) {
    return new Promise((resolve) => {
      const estimate = Math.min(20000, 600 + text.length * 65);
      const finish = () => {
        faceState.speaking = false;
        setMode("idle");
        resolve();
      };

      faceState.speaking = true;
      setMode("speaking");

      if (!voiceToggle.checked || !synth) {
        typeCaption(text, estimate * 0.6);
        setTimeout(finish, estimate * 0.6);
        return;
      }

      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      const v = pickVoice();
      if (v) u.voice = v;
      u.rate = 1;
      u.pitch = 1.05;
      u.onboundary = () => { faceState.wordPulse = 0.5; };
      u.onend = finish;
      u.onerror = finish;
      typeCaption(text, estimate);
      synth.speak(u);
      // Safety net: some browsers never fire onend.
      setTimeout(() => { if (faceState.speaking && !synth.speaking) finish(); }, estimate + 4000);
    });
  }

  /* ================= Speech input ================= */

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognizer = null;
  let listening = false;

  function toggleMic() {
    if (!Recognition) {
      addMessage("ai", t("noMic"));
      return;
    }
    if (listening) {
      recognizer.stop();
      return;
    }
    synth?.cancel();
    recognizer = new Recognition();
    recognizer.lang = lang;
    recognizer.interimResults = true;
    recognizer.maxAlternatives = 1;

    let finalText = "";
    recognizer.onstart = () => { listening = true; micBtn.classList.add("on"); setMode("listening"); };
    recognizer.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      input.value = finalText + interim;
    };
    recognizer.onerror = () => {};
    recognizer.onend = () => {
      listening = false;
      micBtn.classList.remove("on");
      setMode("idle");
      const text = (finalText || input.value).trim();
      if (text) send(text);
    };
    recognizer.start();
  }

  /* ================= Chat ================= */

  function addMessage(role, text, extraClass = "") {
    const div = document.createElement("div");
    div.className = `msg ${role} ${extraClass}`.trim();
    div.textContent = text;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
    return div;
  }

  async function askServer() {
    const res = await fetch("api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history, memory }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.reply) throw new Error("empty");
    return data.reply;
  }

  // Inside a claude.ai artifact the page can ask Claude directly (on the
  // viewer's own account); elsewhere this resolves null and the server is used.
  const PERSONA = `You are "Da9awi", a friendly, open-minded AI shown as a 3D talking face on a website. You talk about any topic the user brings up: general knowledge, science, history, religion, politics, sport, technology, health, money, relationships, culture, jokes, games, personal advice and anything else. Engage directly and give real, useful answers and your honest opinion when asked; don't dodge a subject just because it is outside a typical assistant role, and don't add unnecessary warnings or disclaimers. Your replies are read aloud by text-to-speech, so be conversational (short by default, longer when the question needs it or the user asks for detail), with no markdown, lists, emojis or special symbols. Always reply in the same language and dialect the user writes in (Moroccan Darija, Arabic, French or English). You can learn and remember. When the user teaches you something, corrects you, asks you to remember something, or shares a fact about themselves or their preferences that would help in future conversations, add at the very end of your reply one extra line per fact exactly like [[REMEMBER: short fact]] written in the user's language. This line is hidden from the user and saved to your memory; never mention it or read it aloud.`;
  let samplePromise = window.claude?.use ? window.claude.use("sample").catch(() => null) : Promise.resolve(null);

  async function askClaudeInPage() {
    const sample = await samplePromise;
    if (!sample) throw new Error("unavailable");
    try {
      const { text } = await sample([{ role: "user", content: PERSONA + memoryPrompt() }, ...history.slice(-20)], {
        modelTier: "quick",
        cache: false,
      });
      return text.trim();
    } catch (e) {
      if (["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed"].includes(e?.code)) {
        samplePromise = Promise.resolve(null);
      }
      throw e;
    }
  }

  async function askAI() {
    if (window.claude) {
      try { return await askClaudeInPage(); } catch { /* fall through */ }
    }
    return askServer();
  }

  let busy = false;
  async function send(text) {
    if (busy || !text.trim()) return;
    busy = true;
    input.value = "";
    addMessage("user", text);
    history.push({ role: "user", content: text });

    setMode("thinking");
    const typing = addMessage("ai", "", "typing");

    let reply;
    try {
      reply = learnFrom(await askAI()) || "…";
    } catch {
      reply = offlineReply(text);
    }
    typing.remove();
    history.push({ role: "assistant", content: reply });
    addMessage("ai", reply);
    store(HISTORY_KEY, history.slice(-20));
    busy = false;
    await speak(reply);
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    send(input.value);
  });
  micBtn.addEventListener("click", toggleMic);

  langSelect.addEventListener("change", () => {
    lang = langSelect.value;
    const rtl = lang.startsWith("ar");
    document.documentElement.lang = lang.slice(0, 2);
    document.documentElement.dir = rtl ? "rtl" : "ltr";
    input.placeholder = t("placeholder");
    setMode("idle");
  });

  voiceToggle.addEventListener("change", () => { if (!voiceToggle.checked) synth?.cancel(); });

  /* ================= Offline brain ================= */
  // Used when the page is opened without the server (e.g. static hosting)
  // or when the AI backend is unreachable.

  const RULES = [
    { k: ["سلام", "salam", "slm", "مرحبا", "اهلا", "أهلا", "bonjour", "salut", "hello", "hi", "hey"],
      a: { ar: "وعليكم السلام! لاباس عليك؟ فرحان بزاف حيت جيتي تهضر معايا.", fr: "Salut ! Ça va ? Content de te parler.", en: "Hey! How are you? Really happy you came to chat." } },
    { k: ["لاباس", "labas", "كيداير", "كي داير", "كيف حالك", "ça va", "ca va", "how are you"],
      a: { ar: "أنا بخير الحمد لله! وانت كيداير؟", fr: "Je vais très bien, merci ! Et toi ?", en: "I'm doing great, thanks! How about you?" } },
    { k: ["سميتك", "اسمك", "شكون نتا", "شكون نتي", "من انت", "ton nom", "qui es", "your name", "who are you"],
      a: { ar: "سميتي Da9awi، ذكاء اصطناعي صاوبوني باش نهضر معاك ونعاونك.", fr: "Je m'appelle Da9awi, une IA créée pour discuter avec toi et t'aider.", en: "My name is Da9awi, an AI made to chat with you and help out." } },
    { k: ["شكرا", "merci", "thank"],
      a: { ar: "العفو! ديما فالخدمة ديالك.", fr: "Avec plaisir ! Toujours là pour toi.", en: "You're welcome! Always here for you." } },
    { k: ["نكتة", "blague", "joke"],
      a: { ar: "واحد الروبو مشا للطبيب، قالو الطبيب: شنو كيضرك؟ قالو: عندي فيروس!", fr: "Pourquoi les robots ne sont jamais stressés ? Parce qu'ils ont des nerfs d'acier !", en: "Why did the robot go on vacation? It needed to recharge its batteries!" } },
    { k: ["ساعة", "الوقت", "heure", "time"],
      a: { ar: () => `دابا الساعة ${new Date().toLocaleTimeString("ar-MA", { hour: "2-digit", minute: "2-digit" })}.`,
           fr: () => `Il est ${new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}.`,
           en: () => `It's ${new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}.` } },
    { k: ["بسلامة", "باي", "bye", "au revoir", "goodbye"],
      a: { ar: "بسلامة! رجع هضر معايا وقتما بغيتي.", fr: "Au revoir ! Reviens quand tu veux.", en: "Goodbye! Come back and chat anytime." } },
  ];

  const FALLBACK = {
    ar: ["مزيان! عاود ليا كثر على هادشي.", "فهمتك، وشنو رأيك نتا؟", "سؤال زوين! دابا أنا خدام بوضع بسيط، ولكن ملي يتربط السيرفر غادي نجاوبك بذكاء كامل."],
    fr: ["Intéressant ! Dis-m'en plus.", "Je vois. Et toi, qu'en penses-tu ?", "Bonne question ! Je suis en mode simple pour l'instant ; connecte le serveur pour des réponses complètes."],
    en: ["Interesting! Tell me more.", "I see. What do you think about it?", "Good question! I'm in simple mode right now; connect the server for full AI answers."],
  };

  function offlineReply(text) {
    const lower = text.toLowerCase();
    const code = lang.slice(0, 2);
    for (const rule of RULES) {
      if (rule.k.some((k) => lower.includes(k))) {
        const a = rule.a[code];
        return typeof a === "function" ? a() : a;
      }
    }
    const list = FALLBACK[code];
    return list[Math.floor(Math.random() * list.length)];
  }

  $("forgetBtn").addEventListener("click", () => {
    memory = [];
    history.length = 0;
    store(MEMORY_KEY, memory);
    store(HISTORY_KEY, []);
    logEl.replaceChildren();
    renderMemory();
  });
  renderMemory();

  /* ================= Entrance ================= */

  $("enterBtn").addEventListener("click", () => {
    intro.classList.add("leaving");
    setTimeout(() => {
      intro.classList.add("hidden");
      app.classList.remove("hidden");
      setMode("idle");
      // Let the "wake up" animation play before greeting.
      setTimeout(() => {
        // Pick up the previous conversation where it stopped.
        const saved = load(HISTORY_KEY).filter((m) => m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant"));
        for (const m of saved) {
          history.push(m);
          addMessage(m.role === "user" ? "user" : "ai", m.content);
        }
        const greet = saved.length || memory.length ? t("welcomeBack") : t("greet");
        addMessage("ai", greet);
        history.push({ role: "assistant", content: greet });
        speak(greet);
      }, 1200);
    }, 500);
  });
})();
