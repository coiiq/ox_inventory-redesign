/* Server-controlled presentation. All values are validated before touching CSS. */
(function () {
  'use strict';
  // ox captures and then replaces window.fetch during bundle initialization.
  const requestNui = window.fetch.bind(window);
  const defaults = Object.freeze({ accent: '#50B7F5', background: '#0B1320', text: '#FFFFFF', muted: '#A7B3C4', border: '#2A394D', pattern: '#29405B', tile: '#FFFFFF', opacity: 1, patternOpacity: .18, headingFont: 'barlow', bodyFont: 'barlow', wheelSize: 66, tilt: true, animations: true, sounds: true, volume: 1 });
  const headings = { barlow: 'CoiiHeading,"Arial Narrow",sans-serif', impact: 'Impact,"Arial Narrow",sans-serif', arial: '"Arial Black",Arial,sans-serif' };
  const bodies = { barlow: 'CoiiBody,"Arial Narrow",sans-serif', arial: 'Arial,sans-serif', condensed: '"Arial Narrow",Arial,sans-serif' };
  const colors = ['accent', 'background', 'text', 'muted', 'border', 'pattern', 'tile'];
  let current = { ...defaults }, nativeLoaded = false, pending, revision = 0, applied = false;
  function color(value, fallback) {
    if (typeof value !== 'string' || !/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value)) return fallback;
    return (value.length === 4 ? '#' + [...value.slice(1)].map(x => x + x).join('') : value).toUpperCase();
  }
  const number = (value, fallback, low, high) => typeof value === 'number' && Number.isFinite(value) ? Math.max(low, Math.min(high, value)) : fallback;
  function normalize(value) {
    const data = value && typeof value === 'object' && !Array.isArray(value) ? value : {}, result = { ...defaults };
    for (const key of colors) result[key] = color(data[key], defaults[key]);
    for (const key of ['tilt', 'animations', 'sounds']) result[key] = typeof data[key] === 'boolean' ? data[key] : defaults[key];
    result.opacity = number(data.opacity, 1, .25, 1); result.patternOpacity = number(data.patternOpacity, .18, 0, 1);
    result.wheelSize = number(data.wheelSize, 66, 48, 72); result.volume = number(data.volume, 1, 0, 1);
    if (Object.hasOwn(headings, data.headingFont)) result.headingFont = data.headingFont;
    if (Object.hasOwn(bodies, data.bodyFont)) result.bodyFont = data.bodyFont;
    return result;
  }
  const rgb = value => value.slice(1).match(/../g).map(x => parseInt(x, 16));
  const shift = (value, changes) => value.map((n, i) => Math.max(0, Math.min(255, Math.round(n + changes[i]))));
  const mix = (a, b, amount) => a.map((n, i) => Math.round(n * (1 - amount) + b[i] * amount));
  const luminance = value => value.map(n => { n /= 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; }).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
  const contrast = value => { const l = luminance(value), dark = rgb('#0B1320'), d = luminance(dark); return (l + .05) / (d + .05) >= 1.05 / (l + .05) ? dark : [255, 255, 255]; };
  function apply(value, fromNative = true) {
    const next = normalize(value); if (fromNative) { nativeLoaded = true; revision++; }
    if (applied && Object.keys(defaults).every(key => next[key] === current[key])) return { ...current };
    current = next; applied = true;
    const style = document.documentElement.style, c = Object.fromEntries(colors.map(key => [key, rgb(current[key])]));
    const set = (key, value) => style.setProperty('--coii-' + key, String(value));
    for (const key of colors) set(key + '-rgb', c[key].join(','));
    for (const key of ['accent', 'text', 'muted', 'border', 'pattern']) set(key, current[key]);
    const onAccent = contrast(c.accent), onTile = contrast(c.tile), direction = luminance(c.background) > .5 ? -1 : 1;
    set('surface-rgb', c.background.join(',')); set('surface', `rgba(${c.background.join(',')},${current.opacity})`); set('opacity', current.opacity);
    set('backdrop-rgb', shift(c.background, [-8, -10, -15]).join(','));
    set('light', `rgb(${shift(c.background, [17, 22, 25].map(n => n * direction)).join(',')})`);
    set('hover', `rgb(${shift(c.background, [12, 24, 27].map(n => n * direction)).join(',')})`);
    set('panel-hover', `rgb(${shift(c.background, [12, 16, 20].map(n => n * direction)).join(',')})`);
    set('on-accent', `rgb(${onAccent.join(',')})`); set('on-accent-rgb', onAccent.join(','));
    set('on-accent-muted', `rgb(${mix(onAccent, c.accent, .2).join(',')})`);
    set('ink', `rgb(${onTile.join(',')})`); set('ink-rgb', onTile.join(','));
    set('white', current.tile); set('tile', current.tile);
    set('tile-soft', `rgb(${shift(c.tile, [-8, -7, -5]).join(',')})`);
    set('notice-tile', `rgb(${shift(c.tile, [-10, -8, -5]).join(',')})`);
    set('text-secondary', `rgb(${mix(c.text, c.muted, .6).join(',')})`);
    set('pattern-opacity', current.patternOpacity);
    const patternHeading = shift(c.pattern, [-13, -23, -34]); set('pattern-heading-rgb', patternHeading.join(','));
    for (const [name, delta] of Object.entries({ 'accent-soft': [62, 29, 10], 'accent-hover': [59, 25, 5], 'medical-bloom': [142, 63, 10], 'medical-wave': [84, 45, 10], 'medical-sweep': [96, 48, 10] })) set(name + '-rgb', shift(c.accent, delta).join(','));
    const path = 'M-12 53 48 17 93 77M27-14 105 28 161-12M133 78 186 16 276 67M195-15 225 21 280 2M94-9 120 7 100 23';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 266 64" preserveAspectRatio="none"><path d="${path}" fill="none" stroke="rgb(${patternHeading.join(',')})" stroke-width="2.2" stroke-opacity="${Math.min(1, current.patternOpacity * .4 / .18)}"/></svg>`;
    set('notice-pattern', `url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
    set('font-heading', headings[current.headingFont]); set('font-body', bodies[current.bodyFont]); set('wheel-size', current.wheelSize);
    document.documentElement.dataset.coiiAnimations = current.animations ? 'on' : 'off';
    document.documentElement.dataset.coiiTilt = current.tilt ? 'on' : 'off';
    // Dark panels are CSS colours. Browser dark mode makes CEF's NUI canvas opaque.
    style.colorScheme = 'only light';
    window.dispatchEvent(new CustomEvent('coii:theme', { detail: { ...current } }));
    return { ...current };
  }
  function refresh() {
    if (pending) return pending;
    if (typeof GetParentResourceName !== 'function') return Promise.resolve(false);
    const requestedAt = revision;
    pending = requestNui(`https://${GetParentResourceName()}/coiiTheme`, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: '{}' })
      .then(response => response.json()).then(data => revision === requestedAt && data && typeof data === 'object' && !Array.isArray(data) ? apply(data) : false)
      .catch(() => false).finally(() => { pending = null; });
    return pending;
  }
  window.CoiiTheme = { apply, refresh, get: () => ({ ...current }), soundLevel: () => current.sounds ? current.volume : 0,
    setLegacyAccent(value) { if (!nativeLoaded) apply({ ...current, accent: color(value, current.accent) }, false); } };
  window.addEventListener('message', event => {
    if (event.data?.action === 'coiiTheme') apply(event.data.data);
    else if (event.data?.action === 'setupInventory' || event.data?.action === 'init') refresh();
  });
  apply(defaults, false);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refresh, { once: true }); else refresh();
})();
