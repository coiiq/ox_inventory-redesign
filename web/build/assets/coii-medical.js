/* Local treatment pulse. No camera, gameplay or inventory state. */
(function () {
  'use strict';
  let layer, timer, audio, playing = [], applied = 0;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches || window.CoiiTheme?.get().animations === false;
  const soundLevel = () => window.CoiiTheme?.soundLevel() ?? 1;
  function mount() {
    if (layer) return;
    layer = document.createElement('div'); layer.className = 'coii-medical-fx'; layer.setAttribute('aria-hidden', 'true');
    for (const name of ['edge', 'bloom', 'wave', 'sweep']) {
      const part = document.createElement('i'); part.className = `coii-medical-${name}`; layer.appendChild(part);
    }
    document.body.appendChild(layer);
  }
  function silence(keepAudio = false) {
    for (const node of playing) { try { node.stop?.(); } catch {} try { node.disconnect(); } catch {} }
    playing = [];
    if (!keepAudio && audio && audio.state !== 'closed') audio.suspend().catch(() => {});
  }
  function stop(keepAudio = false) {
    clearTimeout(timer); layer?.classList.remove('is-active'); silence(keepAudio);
  }
  async function whoosh(generation) {
    try {
      const Audio = window.AudioContext || window.webkitAudioContext; if (!Audio || soundLevel() <= 0) return;
      audio ||= new Audio(); await audio.resume();
      if (audio.state !== 'running' || generation !== applied || !layer?.classList.contains('is-active') || soundLevel() <= 0) return;
      const at = audio.currentTime, length = 1.35;
      const buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * length), audio.sampleRate);
      const samples = buffer.getChannelData(0); let previous = 0;
      for (let i = 0; i < samples.length; i++) { previous = (previous + (Math.random() * 2 - 1) * .025) / 1.025; samples[i] = previous * 5; }
      const source = audio.createBufferSource(), filter = audio.createBiquadFilter(), gain = audio.createGain();
      source.buffer = buffer; filter.type = 'bandpass'; filter.Q.value = .65;
      filter.frequency.setValueAtTime(340, at); filter.frequency.exponentialRampToValueAtTime(1800, at + .24); filter.frequency.exponentialRampToValueAtTime(170, at + length);
      gain.gain.setValueAtTime(.0001, at); gain.gain.exponentialRampToValueAtTime(Math.max(.0001,.16 * soundLevel()), at + .1); gain.gain.exponentialRampToValueAtTime(.0001, at + length);
      source.connect(filter).connect(gain).connect(audio.destination); source.start(at); source.stop(at + length); playing.push(source, filter, gain);
      const tone = audio.createOscillator(), envelope = audio.createGain(); tone.type = 'sine';
      tone.frequency.setValueAtTime(180, at); tone.frequency.exponentialRampToValueAtTime(62, at + .65);
      envelope.gain.setValueAtTime(.0001, at); envelope.gain.exponentialRampToValueAtTime(Math.max(.0001,.045 * soundLevel()), at + .07); envelope.gain.exponentialRampToValueAtTime(.0001, at + .8);
      tone.connect(envelope).connect(audio.destination); tone.start(at); tone.stop(at + .85); playing.push(tone, envelope);
    } catch {}
  }
  function play(duration = 2400) {
    mount(); stop(true); applied++;
    duration = Number.isFinite(duration) ? Math.max(1200, Math.min(4000, duration)) : 2400;
    layer.style.setProperty('--medical-duration', `${duration}ms`);
    layer.classList.toggle('is-reduced', reduced()); void layer.offsetWidth;
    layer.classList.add('is-active'); whoosh(applied); timer = setTimeout(stop, duration + 50);
  }
  window.addEventListener('message', event => {
    if (event.data?.action === 'coiiMedicalPulse') play(event.data.data?.duration);
    else if (event.data?.action === 'coiiMedicalStop') stop();
  });
  window.addEventListener('pagehide', () => { stop(); audio?.close(); });
  window.addEventListener('coii:theme', () => { if (soundLevel() <= 0) silence(); });
  // Cosmetic browser QA only; this API cannot grant health.
  window.CoiiMedicalEffect = { play, stop, status: () => ({ active: !!layer?.classList.contains('is-active'), applied, audio: audio?.state, reduced: reduced() }) };
})();
