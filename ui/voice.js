/* global deck, $, activeId, titleOf, terms, tool, extra */
// Optional voice input (Settings, off by default; needs server/voice/ on the server).
// The microphone button or Ctrl+M starts and stops. Held longer than 400 ms = push-to-talk, releasing stops.
// Escape cancels and deletes what was already typed. The text shows up while speaking, without Enter,
// in the prompt of the session that was active at the start.
deck.settings().then(conf => {
  if (!conf.voice) return;
  const HOLD_MS = 400, MAX_S = 120;
  const TICK_MS = 1200; // how often the recording goes to Whisper while speaking
  const FIXED_S = 2;    // parts this far before the end do not change any more and are not recognized again
  // Live transcript runs on the fast model (base), after stopping the accurate one (small) corrects the whole text.
  // Line breaks would act as Enter, control characters do not belong in the prompt.
  const clean = t => String(t).replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim();
  const join = (...t) => t.filter(Boolean).join(' ');
  const tail = (t, n = 90) => (t.length > n ? t.slice(-n).replace(/^\S*\s/, '') : t); // end of the text, from a word start
  const errText = e => String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const el = document.createElement('div');
  el.id = 'voice'; el.setAttribute('role', 'status'); el.hidden = true;
  el.innerHTML = '<i class="dot"></i><span class="level"><b></b></span><span class="text"></span>';
  $('#window').append(el);
  const levelEl = el.querySelector('.level b'), textEl = el.querySelector('.text');

  let rec = null;        // running recording, see start()
  let finishing = null;  // recording after stop whose last recognition is still running
  let pressed = null;    // time at which Ctrl+M started the recording
  let hideTimer = null, starting = false, lateStop = false; // getUserMedia still running

  const show = (text, kind = '') => {
    clearTimeout(hideTimer);
    el.className = kind; textEl.textContent = text; el.hidden = false;
    if (kind === 'error' || kind === 'done') hideTimer = setTimeout(() => { el.hidden = true; }, kind === 'error' ? 5000 : 1200);
  };
  const hide = () => { clearTimeout(hideTimer); el.hidden = true; };

  async function start() {
    const id = activeId();
    if (!id) return show('No session open', 'error');
    let stream;
    starting = true; lateStop = false;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) {
      starting = false;
      return show(e.name === 'NotAllowedError' ? 'Microphone not allowed' : 'No microphone found', 'error');
    }
    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    const chunks = [];
    const audio = new AudioContext(), analyser = audio.createAnalyser();
    audio.createMediaStreamSource(stream).connect(analyser);
    // fixed: safely recognized text up to fixedUntil (seconds), text: fixed + provisional rest, typed: what the prompt shows
    const a = rec = { recorder, stream, audio, id, start: performance.now(), discard: false, chunks, sent: 0, running: null, fixed: '', fixedUntil: 0, text: '', typed: '' };
    recorder.ondataavailable = e => chunks.push(e.data);
    const live = setInterval(() => {
      if (a.running || a.discard || chunks.length === a.sent) return;
      a.running = round(a).catch(() => {}).finally(() => { a.running = null; });
    }, TICK_MS);
    recorder.onstop = () => {
      clearInterval(live);
      mic.classList.remove('on');
      stream.getTracks().forEach(t => t.stop()); audio.close();
      if (rec === a) rec = null;
      if (a.discard) return hide();
      finish(a);
    };
    recorder.start(1000);
    mic.classList.add('on');
    starting = false;
    if (lateStop) stop();
    // Level and seconds until the recording ends
    const values = new Uint8Array(analyser.fftSize);
    const tick = () => {
      if (rec !== a) return;
      analyser.getByteTimeDomainData(values);
      let sum = 0;
      for (const w of values) sum += ((w - 128) / 128) ** 2;
      levelEl.style.transform = `scaleX(${Math.min(1, Math.sqrt(sum / values.length) * 4)})`;
      const s = (performance.now() - a.start) / 1000;
      textEl.textContent = a.text ? tail(a.text) : keyLabel(`${Math.floor(s)} s · click or Ctrl+M stops, Esc cancels`);
      if (s >= MAX_S) return stop();
      requestAnimationFrame(tick);
    };
    show('0 s', 'recording');
    tick();
  }

  function stop(discard = false) {
    pressed = null;
    if (!rec) return;
    rec.discard = discard;
    if (rec.recorder.state !== 'inactive') rec.recorder.stop();
  }

  // Bring the prompt to the new state: delete from the first difference with Backspace and type again.
  function type(a, want) {
    const have = a.typed;
    let n = 0;
    while (n < have.length && n < want.length && have[n] === want[n]) n++;
    const del = [...have.slice(n)].length;
    if (del || n < want.length) deck.write(a.id, '\x7f'.repeat(del) + want.slice(n));
    a.typed = want;
  }

  // Sends the recording so far; while speaking Whisper only recognizes from fixedUntil, at the end everything.
  // ponytail: cut at Whisper segment borders, rarely a word start gets lost there; recognizing all again would be quadratic.
  async function round(a, end = false) {
    a.sent = a.chunks.length;
    const blob = new Blob(a.chunks, { type: a.recorder.mimeType });
    const r = await deck.call('voice:recognize', new Uint8Array(await blob.arrayBuffer()), end ? 0 : a.fixedUntil, !end);
    if (a.discard) return;
    if (end) a.fixed = '';
    const open = [];
    for (const t of r.parts) {
      if (!open.length && (end || t.end < r.duration - FIXED_S)) { a.fixed = join(a.fixed, clean(t.text)); a.fixedUntil = t.end; } else open.push(clean(t.text));
    }
    a.text = join(a.fixed, ...open);
    type(a, a.text);
  }

  async function finish(a) {
    finishing = a;
    show(a.text ? `refining: ${tail(a.text, 70)}` : 'recognizing', 'recognizing');
    try {
      await a.running;
      await round(a, true);
      if (a.discard) return;
      if (!a.text) return show('Nothing understood', 'error');
      show(`typed into ${titleOf(a.id)}`, 'done');
      terms.get(a.id)?.term.focus();
    } catch (e) {
      if (!a.discard) show(errText(e), 'error');
    } finally { if (finishing === a) finishing = null; }
  }

  // Esc: cancel recording or recognition and delete what was already typed
  function cancel() {
    const a = rec || finishing;
    finishing = null;
    if (!a) return hide();
    a.discard = true;
    type(a, '');
    if (a === rec) stop(true); else hide();
  }

  const toggle = () => (rec ? stop() : starting || start());
  const mic = tool('Voice input (Ctrl+M)', '<rect x="6" y="1.8" width="4" height="7.4" rx="2"/><path d="M3.8 7.6a4.2 4.2 0 0 0 8.4 0M8 11.8v2.4M5.8 14.2h4.4"/>', toggle);
  el.addEventListener('click', () => { if (rec) stop(); else if (el.classList.contains('error') || el.classList.contains('done')) hide(); });

  extra.palette.push(() => [{ text: rec ? 'Stop voice input' : 'Voice input', hint: 'Ctrl+M', run: toggle }]);
  extra.shortcuts.push((e, ctrl) => {
    if (e.key === 'Escape' && (rec || finishing)) return cancel;
    if (!ctrl || e.shiftKey || e.code !== 'KeyM') return null;
    // Swallow repeats while holding, otherwise Ctrl+M would reach the terminal as Enter.
    if (e.repeat) return () => {};
    return () => { if (rec) stop(); else if (!starting) { pressed = Date.now(); start(); } };
  });
  document.addEventListener('keyup', e => {
    if (e.code !== 'KeyM' && e.key !== 'Control' && e.key !== 'Meta') return;
    if (pressed && Date.now() - pressed > HOLD_MS) { if (starting) lateStop = true; else stop(); }
    pressed = null;
  }, true);
}).catch(() => {});
