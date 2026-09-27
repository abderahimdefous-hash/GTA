(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const intro = $("intro");
  const app = $("app");
  const stage = document.querySelector(".stage");
  const face = $("face");
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
      greet: "السلام عليكم! أنا نور، الذكاء الاصطناعي ديالك. شنو بغيتي نهضرو عليه اليوم؟",
      idle: "واجد…", listening: "كنسمعك…", thinking: "كنفكر…", speaking: "كنهضر…",
      placeholder: "كتب شي حاجة ولا ضغط على الميكرو…",
      noMic: "المتصفح ديالك ما كيدعمش الميكرو، جرب Chrome.",
    },
    "fr-FR": {
      greet: "Bonjour ! Je suis Nour, ton intelligence artificielle. De quoi veux-tu parler aujourd'hui ?",
      idle: "Prête…", listening: "Je t'écoute…", thinking: "Je réfléchis…", speaking: "Je parle…",
      placeholder: "Écris quelque chose ou appuie sur le micro…",
      noMic: "Ton navigateur ne supporte pas le micro, essaie Chrome.",
    },
    "en-US": {
      greet: "Hi there! I'm Nour, your AI companion. What would you like to talk about today?",
      idle: "Ready…", listening: "Listening…", thinking: "Thinking…", speaking: "Speaking…",
      placeholder: "Type something or tap the mic…",
      noMic: "Your browser doesn't support the microphone, try Chrome.",
    },
  };

  let lang = "ar-MA";
  const t = (key) => TEXT[lang][key];
  const history = [];

  /* ================= Face animation ================= */

  const eyes = [$("eyeL"), $("eyeR")].map((g) => ({
    pupil: g.querySelector(".pupil-group"),
    lid: g.querySelector(".lid"),
  }));
  const browL = $("browL");
  const browR = $("browR");
  const mouthInner = $("mouthInner");
  const mouthLine = $("mouthLine");
  const head = $("head");

  const faceState = {
    lookX: 0, lookY: 0,           // current pupil offset
    targetX: 0, targetY: 0,       // where the pupils want to go
    blink: 0,                     // 0 open .. 1 closed
    nextBlink: performance.now() + 2000,
    mouthOpen: 0, mouthTarget: 0, // 0 .. 1
    smile: 0.35, smileTarget: 0.35,
    speaking: false,
    wordPulse: 0,
  };

  window.addEventListener("pointermove", (e) => {
    const r = face.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2);
    const dy = (e.clientY - (r.top + r.height * 0.42)) / (window.innerHeight / 2);
    faceState.targetX = Math.max(-1, Math.min(1, dx));
    faceState.targetY = Math.max(-1, Math.min(1, dy));
  });

  function mouthPath(open, smile) {
    const w = 55 - open * 12;
    const s = smile * 18;
    const top = s - open * 10;
    const bottom = s + open * 48;
    return {
      inner: `M${-w} 0 Q0 ${top} ${w} 0 Q0 ${bottom} ${-w} 0 Z`,
      line: open > 0.04
        ? `M${-w} 0 Q0 ${top} ${w} 0 Q0 ${bottom} ${-w} 0`
        : `M${-w} 0 Q0 ${s} ${w} 0`,
    };
  }

  function animate(now) {
    const f = faceState;

    // Eyes follow the pointer smoothly.
    f.lookX += (f.targetX - f.lookX) * 0.12;
    f.lookY += (f.targetY - f.lookY) * 0.12;
    const px = f.lookX * 14;
    const py = f.lookY * 8;
    eyes.forEach((e) => e.pupil.setAttribute("transform", `translate(${px.toFixed(2)} ${py.toFixed(2)})`));

    // Head tilts slightly toward the pointer.
    head.setAttribute("transform", `rotate(${(f.lookX * 3).toFixed(2)} 200 230) translate(${(f.lookX * 4).toFixed(2)} ${(f.lookY * 3).toFixed(2)})`);

    // Random blinking.
    if (now > f.nextBlink) {
      f.blink = 1;
      f.nextBlink = now + 2200 + Math.random() * 3500;
    }
    f.blink = Math.max(0, f.blink - 0.12);
    const lidH = Math.sin(f.blink * Math.PI) * 60;
    eyes.forEach((e) => e.lid.setAttribute("height", lidH.toFixed(1)));

    // Mouth: while speaking, jitter the opening to fake lip-sync,
    // with extra kicks on each spoken word boundary.
    if (f.speaking) {
      const wobble = (Math.sin(now / 70) + Math.sin(now / 43 + 1.3)) * 0.25 + 0.45;
      f.mouthTarget = Math.max(0.1, Math.min(1, wobble + f.wordPulse));
      f.wordPulse *= 0.9;
    } else {
      f.mouthTarget = 0;
    }
    f.mouthOpen += (f.mouthTarget - f.mouthOpen) * 0.35;
    f.smile += (f.smileTarget - f.smile) * 0.08;
    const m = mouthPath(f.mouthOpen, f.smile);
    mouthInner.setAttribute("d", m.inner);
    mouthLine.setAttribute("d", m.line);

    // Eyebrows lift a little while talking.
    const lift = f.speaking ? Math.sin(now / 260) * 3 - 2 : 0;
    browL.setAttribute("transform", `translate(0 ${lift.toFixed(2)})`);
    browR.setAttribute("transform", `translate(0 ${lift.toFixed(2)})`);

    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  function setMode(mode) {
    stage.classList.remove("speaking", "listening", "thinking");
    if (mode !== "idle") stage.classList.add(mode);
    statusEl.textContent = t(mode);
    faceState.smileTarget = mode === "thinking" ? -0.1 : 0.35;
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
        stage.classList.remove("happy");
        setMode("idle");
        resolve();
      };

      faceState.speaking = true;
      stage.classList.add("happy");
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
      body: JSON.stringify({ messages: history }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.reply) throw new Error("empty");
    return data.reply;
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
      reply = await askServer();
    } catch {
      reply = offlineReply(text);
    }
    typing.remove();
    history.push({ role: "assistant", content: reply });
    addMessage("ai", reply);
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
      a: { ar: "وعليكم السلام! لاباس عليك؟ فرحانة بزاف حيت جيتي تهضر معايا.", fr: "Salut ! Ça va ? Contente de te parler.", en: "Hey! How are you? Really happy you came to chat." } },
    { k: ["لاباس", "labas", "كيداير", "كي داير", "كيف حالك", "ça va", "ca va", "how are you"],
      a: { ar: "أنا بخير الحمد لله! وانت كيداير؟", fr: "Je vais très bien, merci ! Et toi ?", en: "I'm doing great, thanks! How about you?" } },
    { k: ["سميتك", "اسمك", "شكون نتا", "شكون نتي", "من انت", "ton nom", "qui es", "your name", "who are you"],
      a: { ar: "سميتي نور، ذكاء اصطناعي صاوبوني باش نهضر معاك ونعاونك.", fr: "Je m'appelle Nour, une IA créée pour discuter avec toi et t'aider.", en: "My name is Nour, an AI made to chat with you and help out." } },
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
    ar: ["مزيان! عاود ليا كثر على هادشي.", "فهمتك، وشنو رأيك نتا؟", "سؤال زوين! دابا أنا خدامة بوضع بسيط، ولكن ملي يتربط السيرفر غادي نجاوبك بذكاء كامل."],
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

  /* ================= Entrance ================= */

  $("enterBtn").addEventListener("click", () => {
    intro.classList.add("leaving");
    setTimeout(() => {
      intro.classList.add("hidden");
      app.classList.remove("hidden");
      setMode("idle");
      // Let the "wake up" animation play before greeting.
      setTimeout(() => {
        const greet = t("greet");
        addMessage("ai", greet);
        history.push({ role: "assistant", content: greet });
        speak(greet);
      }, 1200);
    }, 500);
  });
})();
