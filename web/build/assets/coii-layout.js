/* COII radial inventory. Stock ox slots retain drag/drop and item actions. */
(function () {
  'use strict';
  // Same local hover synthesis as coii_target: two short notes, volume .35.
  let hoverContext, hoverResuming, hoverPending, hoverLast = -Infinity, hoverEnabled = false;
  function hoverTone(start, end, length, level, type = 'sine') {
    const at = hoverContext.currentTime, oscillator = hoverContext.createOscillator(), envelope = hoverContext.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(start, at);
    oscillator.frequency.exponentialRampToValueAtTime(end, at + length);
    envelope.gain.setValueAtTime(.0001, at);
    envelope.gain.exponentialRampToValueAtTime(Math.max(.0002, level * .35 * (window.CoiiTheme?.soundLevel() ?? 1)), at + .003);
    envelope.gain.exponentialRampToValueAtTime(.0001, at + length);
    oscillator.connect(envelope); envelope.connect(hoverContext.destination);
    oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
    oscillator.start(at); oscillator.stop(at + length + .005);
  }
  function synthHover() { hoverTone(1150, 690, .022, .10, 'triangle'); hoverTone(2200, 1500, .012, .035); }
  function playHover() {
    if (!hoverEnabled || (window.CoiiTheme?.soundLevel() ?? 1) <= 0) return;
    const now = performance.now();
    if (now - hoverLast < 35) return;
    hoverLast = now;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      hoverContext ||= new Audio({ latencyHint: 'interactive' });
      if (hoverContext.state === 'running') { synthHover(); return; }
      hoverPending = { at: now };
      hoverResuming ||= hoverContext.resume().then(() => {
        const cue = hoverPending; hoverPending = null;
        if (cue && hoverEnabled && hoverContext.state === 'running' && performance.now() - cue.at < 180) synthHover();
      }).catch(() => {}).finally(() => { hoverResuming = null; });
    } catch { /* Audio cannot interrupt inventory actions. */ }
  }
  function unlockHover() {
    if (hoverEnabled && (window.CoiiTheme?.soundLevel() ?? 1) > 0 && hoverContext?.state === 'suspended') hoverContext.resume().catch(() => {});
  }
  const present = item => Boolean(item?.name);
  let inspectionSequence = 0;
  const polar = (angle, radius) => [0.5 + Math.cos(angle * Math.PI / 180) * radius, 0.5 + Math.sin(angle * Math.PI / 180) * radius];
  const point = p => p.map(n => Number(n.toFixed(7))).join(' ');
  const sector = (index, outer = 0.499, inner = 0.231) => {
    const from = -112.5 + index * 45, to = from + 45;
    return `M ${point(polar(from, outer))} A ${outer} ${outer} 0 0 1 ${point(polar(to, outer))} L ${point(polar(to, inner))} A ${inner} ${inner} 0 0 0 ${point(polar(from, inner))} Z`;
  };
  window.CoiiInventory = {
    backpackItems: { backpack: true },
    inspectItem(request) { window.dispatchEvent(new CustomEvent('coii:inspect', { detail: request })); },
    canInspect(item) {
      const prop = window.CoiiInventory.runtime?.items[item?.name]?.prop;
      const model = prop && typeof prop === 'object' ? prop.model : prop;
      return typeof model === 'string' ? model.trim().length > 0 && model.length <= 100
        : typeof model === 'number' && Number.isInteger(model) && model !== 0;
    },
    backpackSlot(player) {
      return Number(player?.backpackSlot || window.CoiiInventory.equipmentSlot || (Number(player?.quickSlotStart) + 5) || 0);
    },
    canDropSlot(drag, type, slot, targetItem) {
      const player = window.CoiiInventory.runtime?.store.getState().inventory.leftInventory;
      const equipped = window.CoiiInventory.backpackSlot(player);
      const bags = window.CoiiInventory.backpackItems;
      return !(type === 'player' && slot === equipped && !bags[drag.item.name])
        && !(drag.inventory === 'player' && drag.item.slot === equipped && type !== 'newdrop' && targetItem?.name && !bags[targetItem.name]);
    },
    quickItems(player) {
      const start = Number(player.quickSlotStart || window.CoiiInventory.quickSlotStart || 0);
      if (!start || start + 4 > player.slots) return [];
      return Array.from({ length: 5 }, (_, index) => (player.items || []).find(item => item.slot === start + index) || { slot: start + index });
    },
    quickKey(slot) {
      const player = window.CoiiInventory.runtime?.store.getState().inventory.leftInventory;
      const start = Number(player?.quickSlotStart || window.CoiiInventory.quickSlotStart || 0);
      return start && slot >= start && slot < start + 5 ? slot - start + 1 : 0;
    },
    createNotifications({ React: R, useNuiEvent, image, items, locale, portal }) {
      const h = R.createElement;
      const actions = {
        ui_added: 'ADDED', ui_removed: 'REMOVED', ui_equipped: 'EQUIPPED', ui_holstered: 'HOLSTERED',
        ui_dropped: 'DROPPED', ui_picked_up: 'PICKED UP', ui_stored: 'STORED', ui_taken: 'TAKEN',
        ui_given: 'GIVEN', ui_received: 'RECEIVED'
      };
      function Notifications({ children }) {
        const [notices, setNotices] = R.useState([]);
        const active = R.useRef([]), pending = R.useRef([]), timer = R.useRef(0), sequence = R.useRef(0), alive = R.useRef(true);
        const update = R.useCallback(() => {
          if (!alive.current) return;
          clearTimeout(timer.current);
          const now = performance.now();
          active.current = active.current.filter(note => !note.leaving || note.expires > now);
          for (const note of active.current) if (!note.leaving && note.expires <= now) { note.leaving = true; note.expires = now + 360; }
          while (active.current.length < 4 && pending.current.length) {
            active.current.push({ ...pending.current.shift(), expires: now + 3200, leaving: false });
          }
          setNotices(active.current.map(note => ({ ...note })));
          if (active.current.length) timer.current = setTimeout(update, Math.max(1, Math.min(...active.current.map(note => note.expires)) - now));
        }, []);
        useNuiEvent('itemNotify', data => {
          if (!Array.isArray(data) || !data[0] || typeof data[0].name !== 'string' || !data[0].name) return;
          const [item, action, amount] = data, metadata = item.metadata || {};
          const label = String(metadata.label || items[item.name]?.label || item.label || item.name).slice(0, 180);
          const count = amount == null ? null : Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(Math.abs(Number(amount) || 0))));
          if (count === 0) return;
          const text = actions[action] || String(locale[action] || 'UPDATED').toUpperCase();
          const key = JSON.stringify([item.name, action, label, metadata.container, metadata.serial, metadata.type, metadata.image, metadata.imageurl]);
          const prior = active.current.find(note => note.key === key && !note.leaving) || pending.current.find(note => note.key === key);
          if (prior) {
            if (count != null && prior.count != null) prior.count = Math.min(Number.MAX_SAFE_INTEGER, prior.count + count);
            if (prior.expires) prior.expires = performance.now() + 3200;
          } else {
            if (pending.current.length >= 16) pending.current.shift();
            pending.current.push({ id: ++sequence.current, key, label, count, text, image: image(item), action: String(action || 'updated') });
          }
          update();
        });
        R.useEffect(() => {
          alive.current = true;
          return () => { alive.current = false; clearTimeout(timer.current); active.current = []; pending.current = []; };
        }, []);
        return h(R.Fragment, null, children, portal(h('aside', { className: 'coii-item-notices', 'aria-label': 'Item notifications', 'aria-live': 'polite', 'aria-atomic': false },
          notices.map(note => h('div', { key: note.id, className: `coii-item-notice ${note.leaving ? 'is-leaving' : ''}`, 'data-action': note.action,
            role: 'status', 'aria-label': `${note.label}, ${note.text}${note.count == null ? '' : `, ${note.count}`}` },
            h('div', { className: 'coii-notice-image' },
              h('svg', { className: 'coii-notice-fallback', viewBox: '0 0 32 36', 'aria-hidden': true }, h('path', { d: 'M3 10 16 3l13 7v16l-13 7-13-7V10Zm0 0 13 7 13-7M16 17v16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 })),
              note.image && h('img', { src: note.image, alt: '', onLoad: event => event.currentTarget.parentElement.classList.add('has-image'), onError: event => { event.currentTarget.style.display = 'none'; event.currentTarget.parentElement.classList.remove('has-image'); } })),
            h('div', { className: 'coii-notice-copy' }, h('p', { className: 'coii-notice-name' }, note.label),
              h('p', { className: 'coii-notice-detail' }, h('span', null, note.text), note.count != null && h('b', null, `×${note.count.toLocaleString()}`)))))
        ), document.body));
      }
      return Notifications;
    },
    createLayout(runtime) {
      const { React: R, Slot, useSelector, useDispatch, getLeft, getRight, store, fetchNui, useNuiEvent,
        items: definitions, image, setAmount, useDrop, move, useItem, giveItem, buyItem, craftItem,
        findSlot, canAccess, canCraft, openTooltip, closeTooltip, closeContext } = runtime;
      const h = R.createElement;
      const empty = { id: '', type: 'coii_pack', slots: 0, items: [] };
      const label = item => item?.metadata?.label || definitions[item?.name]?.label || item?.name || '';
      const titleFor = inv => inv?.coiiGroundBackpack ? 'BACKPACK' : ({ newdrop: 'GROUND', drop: 'GROUND', dumpster: 'TRASH', shop: 'MARKET', crafting: 'CRAFTING', trunk: 'TRUNK', glovebox: 'GLOVEBOX', otherplayer: 'PLAYER', inspect: 'INSPECT', container: 'CONTAINER', stash: 'STORAGE' }[inv?.type] || 'GROUND');
      const compact = count => Number(count || 0).toLocaleString(undefined, { notation: Number(count) >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 });
      const kgFormat = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 3 });
      const kilograms = grams => kgFormat.format(Math.max(0, Number(grams) || 0) / 1000);
      const catalogue = type => type === 'shop' || type === 'crafting';
      const stackWeight = (item, type) => {
        if (!present(item)) return 0;
        const count = Math.max(0, Number(item.count ?? 1) || 0), supplied = Number(item.weight);
        if (item.weight != null && Number.isFinite(supplied)) return Math.max(0, supplied) * (catalogue(type) ? count : 1);
        return Math.max(0, (Number(definitions[item.name]?.weight) || 0) + (Number(item.metadata?.weight) || 0)) * count;
      };
      const unitWeight = (item, type) => catalogue(type) && item?.weight != null
        ? Math.max(0, Number(item.weight) || 0) : stackWeight(item, type) / Math.max(1, Number(item?.count ?? 1) || 1);
      const inventoryWeight = inventory => (inventory.items || []).reduce((weight, item) => weight + stackWeight(item, inventory.type), 0);
      const capacityLabel = inventory => `${kilograms(inventoryWeight(inventory))} / ${kilograms(inventory.maxWeight)} KG`;
      const readOnly = inv => ['shop', 'crafting', 'inspect'].includes(inv.type);
      function Key({ children }) { return h('kbd', null, h('span', null, children)); }
      function HeadingLines() { return h('svg', { className: 'coii-heading-lines', viewBox: '0 0 266 64', preserveAspectRatio: 'none', 'aria-hidden': true },
        h('path', { d: 'M-12 53 48 17 93 77M27-14 105 28 161-12M133 78 186 16 276 67M195-15 225 21 280 2M94-9 120 7 100 23' })); }
      function CarryWeight({ inventory }) {
        const weight = inventoryWeight(inventory), capacity = Math.max(0, Number(inventory.maxWeight) || 0);
        return h(R.Fragment, null, h('p', { className: `coii-profile-weight ${capacity && weight > capacity ? 'is-overweight' : ''}`, 'aria-label': 'Carried weight',
          'data-weight-grams': weight, 'data-capacity-grams': capacity }, capacityLabel(inventory)),
          h(WeightBar, { weight, capacity, label: 'Carrying capacity', className: 'coii-profile-progress' }));
      }
      function WeightBar({ weight, capacity, label, className }) {
        return capacity > 0 && h('div', { className: `${className} ${weight > capacity ? 'is-overweight' : ''}`, role: 'progressbar',
            'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': capacity / 1000,
            'aria-valuenow': Number((Math.min(weight, capacity) / 1000).toFixed(3)), 'aria-valuetext': `${kilograms(weight)} of ${kilograms(capacity)} kilograms` },
            h('i', { style: { width: `${Math.max(0, Math.min(100, weight / capacity * 100))}%` } }));
      }
      const sameInspectedItem = (item, identity) => present(item) && item.name === identity.name
        && (item.metadata?.serial || '') === identity.serial && (item.metadata?.container || '') === identity.container;
      function InspectionHints({ controls, back }) {
        const ready = Boolean(controls?.ready), zoom = controls?.zoom ?? 1;
        return h('div', { className: 'coii-hints coii-inspect-hints' },
          h('span', { title: 'Hold the left mouse button and drag the item' }, h(Key, null, 'LMB'), ' DRAG ROTATE'),
          h('span', null, h(Key, null, h('svg', { viewBox: '0 0 18 28', 'aria-hidden': true },
            h('rect', { x: 2, y: 1, width: 14, height: 25, rx: 6, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }),
            h('path', { d: 'M9 2v9M2 12h14', stroke: 'currentColor', strokeWidth: 1.5 }))), ' SCROLL ZOOM'),
          h('button', { type: 'button', className: 'coii-inspect-reset', disabled: !ready, onClick: () => controls?.reset(), 'aria-label': 'Reset item view', title: 'Double-click the item to reset rotation and zoom' }, h(Key, null, '2×LMB'), ' RESET'),
          controls?.hasAttachments && h('button', { type: 'button', className: controls.attachmentsVisible ? 'coii-parts-toggle is-active' : 'coii-parts-toggle', 'aria-pressed': controls.attachmentsVisible, 'aria-label': 'Toggle weapon attachment points', onClick: controls.toggleAttachments }, h(Key, null, 'A'), ' PARTS'),
          h('div', { className: 'coii-inspect-zoom', 'aria-label': 'Item zoom controls' },
            h('button', { type: 'button', disabled: !ready || zoom <= .65, onClick: () => controls?.zoomOut(), 'aria-label': 'Zoom out' }, '−'),
            h('output', { 'aria-label': 'Item zoom' }, `${Math.round(zoom * 100)}%`),
            h('button', { type: 'button', disabled: !ready || zoom >= 2.5, onClick: () => controls?.zoomIn(), 'aria-label': 'Zoom in' }, '+')),
          h('button', { type: 'button', onClick: back, 'aria-label': 'Back to inventory' }, h(Key, null, 'I'), ' BACK'),
          h('button', { type: 'button', onClick: () => fetchNui('exit', {}) }, h(Key, null, 'ESC'), ' CLOSE'));
      }
      function AttachmentEditor({ item, inventory, session, ready, mounts, visible }) {
        const carried = useSelector(getLeft);
        const [state, setState] = R.useState(null), [loading, setLoading] = R.useState(true);
        const [pending, setPending] = R.useState(''), [error, setError] = R.useState('');
        const sequence = R.useRef(0), alive = R.useRef(true), working = R.useRef(false);
        const [selected, setSelected] = R.useState(null), [hovered, setHovered] = R.useState(null);
        const nodes = R.useRef(new Map()), lines = R.useRef(new Map()), layer = R.useRef(null);
        const points = R.useRef([]), paint = R.useRef(0);
        const redraw = () => {
          paint.current = 0;
          layer.current?.setAttribute('viewBox', `0 0 ${innerWidth} ${innerHeight}`);
          for (const [id, line] of lines.current) {
            if (!line) continue;
            const point = points.current.find(value => value.id === id), icon = nodes.current.get(id);
            const valid = visible && point?.visible && Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1 && icon;
            line.style.opacity = valid ? '1' : '0';
            if (!valid) continue;
            const rect = icon.getBoundingClientRect(), x = point.x * innerWidth, y = point.y * innerHeight;
            const endX = rect.x + rect.width / 2, endY = rect.y + rect.height / 2;
            const left = icon.closest('.coii-part-node').dataset.side === 'left';
            line.querySelector('path').setAttribute('d', `M ${x} ${y} L ${endX + (left ? 30 : -30)} ${endY} L ${endX} ${endY}`);
            const dot = line.querySelector('circle'); dot.setAttribute('cx', x); dot.setAttribute('cy', y);
          }
        };
        const schedule = () => { if (!paint.current) paint.current = requestAnimationFrame(redraw); };
        useNuiEvent('coiiInspectAnchors', data => { if (data?.session === session.current && Array.isArray(data.points)) { points.current = data.points; schedule(); } });
        R.useEffect(() => {
          if (!ready || !session.current) return;
          const token = session.current;
          fetchNui('coiiInspectAnchors', { session: token, enabled: visible }).catch(() => {});
          return () => { fetchNui('coiiInspectAnchors', { session: token, enabled: false }).catch(() => {}); };
        }, [ready, visible]);
        R.useEffect(() => { schedule(); });
        R.useEffect(() => {
          window.addEventListener('resize', schedule);
          return () => { window.removeEventListener('resize', schedule); if (paint.current) cancelAnimationFrame(paint.current); };
        }, []);
        R.useEffect(() => {
          const outside = event => { if (!event.target.closest('.coii-part-node')) setSelected(null); };
          const escape = event => { if (event.code === 'Escape') setSelected(null); };
          window.addEventListener('pointerdown', outside); window.addEventListener('keydown', escape);
          return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape); };
        }, []);
        const fingerprint = JSON.stringify(carried.items.map(value => [value.slot, value.name, value.count, value.metadata]));
        const components = JSON.stringify(item.metadata?.components || []);
        const editable = inventory.type === 'player' && inventory.id === carried.id;
        const request = () => ({ inventory: inventory.type, slot: item.slot, name: item.name, serial: item.metadata?.serial, session: session.current });
        R.useEffect(() => { alive.current = true; return () => { alive.current = false; sequence.current++; }; }, []);
        R.useEffect(() => {
          if (!editable || !ready || working.current) return;
          const version = ++sequence.current;
          setLoading(true);
          fetchNui('coiiAttachmentState', request()).then(value => {
            if (!alive.current || version !== sequence.current) return;
            setState(value && typeof value === 'object' ? value : null);
            setError(value ? '' : 'Attachments could not be loaded.'); setLoading(false);
          }).catch(() => { if (alive.current && version === sequence.current) { setLoading(false); setError('Attachments could not be loaded.'); } });
        }, [fingerprint, components, editable, ready]);
        const change = async (action, component) => {
          if (!editable || !ready || !state || working.current) return;
          working.current = true; sequence.current++; setPending(`${action}:${component}`); setError('');
          try {
            const result = await fetchNui('coiiInspectAttachment', { ...request(), action, component, revision: state.revision });
            if (!alive.current) return;
            if (result?.state) setState(result.state);
            if (!result?.ok) setError(result?.error || 'Could not update this attachment.');
          } catch { if (alive.current) setError('Could not update this attachment. Please try again.'); }
          finally { working.current = false; if (alive.current) { setPending(''); setLoading(false); } }
        };
        const installed = editable && state ? state.installed || [] : (item.metadata?.components || []).map(name => {
          const group = mounts.find(mount => mount.parts?.some(part => part.name === name));
          return { name, label: definitions[name]?.label || group?.parts.find(part => part.name === name)?.label || name, type: group?.id || 'attachment' };
        });
        const row = (option, fitted) => {
          const action = fitted ? 'remove' : 'install', active = pending === `${action}:${option.name}`;
          const missing = !fitted && !(Number(option.count) > 0);
          const blocked = !fitted && Boolean(option.blocked);
          const checking = loading || !state;
          const status = fitted ? 'INSTALLED' : !editable ? 'COMPATIBLE' : missing ? 'NOT OWNED' : `${option.count} OWNED`;
          return h('div', { className: `coii-attachment-row${missing ? ' is-unavailable' : ''}`, key: option.name, 'data-component': option.name },
            h('img', { src: image({ name: option.name }), alt: '', draggable: false }),
            h('div', { className: 'coii-attachment-label' }, h('b', null, option.label), h('span', null, `${String(option.type).toUpperCase()} · ${status}`)),
            editable && h('button', { type: 'button', disabled: Boolean(pending) || !ready || checking || missing || blocked,
              title: checking ? 'Checking carried attachments…' : missing ? 'You do not have this attachment.' : blocked ? 'Remove the installed attachment of this type first.' : undefined,
              'aria-label': `${fitted ? 'Remove' : 'Install'} ${option.label}`, onClick: () => change(action, option.name) }, active ? '…' : fitted ? 'REMOVE' : missing ? 'UNAVAILABLE' : blocked ? 'REMOVE FIRST' : 'INSTALL'));
        };
        const sideFor = id => ['scope', 'magazine', 'skin'].includes(id) ? 'left' : 'right';
        const ordered = [...mounts].sort((a, b) => ['scope', 'muzzle', 'flashlight', 'magazine', 'grip', 'barrel', 'skin'].indexOf(a.id) - ['scope', 'muzzle', 'flashlight', 'magazine', 'grip', 'barrel', 'skin'].indexOf(b.id));
        return h('div', { className: 'coii-attachment-editor coii-attachment-space', hidden: !visible, 'aria-label': 'Weapon attachment points', 'aria-busy': Boolean(pending) || editable && loading },
          h('svg', { ref: layer, className: 'coii-part-leaders', 'aria-hidden': true }, ...ordered.map(mount => h('g', { key: mount.id, ref: node => { if (node) lines.current.set(mount.id, node); else lines.current.delete(mount.id); }, className: selected === mount.id || hovered === mount.id ? 'is-active' : '', 'data-mount': mount.id, style: { opacity: 0 } }, h('path', { fill: 'none' }), h('circle', { r: 2.5 })))),
          ...ordered.map(mount => {
            const side = sideFor(mount.id), peers = ordered.filter(value => sideFor(value.id) === side), index = peers.findIndex(value => value.id === mount.id);
            const y = peers.length === 1 ? 43 : 29 + index * Math.min(19, 36 / (peers.length - 1));
            const fitted = installed.filter(option => option.type === mount.id);
            const available = (mount.parts || []).filter(part => !fitted.some(option => option.name === part.name)).map(part => {
              const carried = state?.available?.find(option => option.name === part.name);
              return { ...part, type: mount.id, count: Number(carried?.count) || 0, blocked: Boolean(carried?.blocked) || fitted.length > 0 };
            });
            const active = selected === mount.id;
            return h('div', { className: `coii-part-node ${active ? 'is-active' : ''}`, key: mount.id, 'data-side': side, 'data-mount': mount.id, style: { top: `${y}vh` },
              onPointerEnter: () => setHovered(mount.id), onPointerLeave: () => setHovered(null) },
              h('button', { type: 'button', className: 'coii-part-trigger', 'aria-expanded': active, 'aria-controls': `coii-part-menu-${mount.id}`, 'aria-label': `${mount.label} attachment`, onClick: () => { setSelected(active ? null : mount.id); setError(''); } },
                h('span', { className: 'coii-part-icon', ref: node => { if (node) nodes.current.set(mount.id, node); else nodes.current.delete(mount.id); } }, fitted[0] ? h('img', { src: image({ name: fitted[0].name }), alt: '', draggable: false }) : h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': true }, h('path', { d: 'M12 5v14M5 12h14' }))),
                h('span', { className: 'coii-part-name' }, h('strong', null, mount.label), h('span', null, fitted[0]?.label || 'Factory part'))),
              active && h('div', { className: `coii-part-menu ${y > 52 ? 'opens-up' : ''}`, id: `coii-part-menu-${mount.id}`, role: 'region', 'aria-label': `${mount.label} options` },
                h('div', { className: 'coii-part-menu-heading' }, h('strong', null, mount.label), h('button', { type: 'button', 'aria-label': 'Close attachment options', onClick: () => setSelected(null) }, '×')),
                editable && loading && !state ? h('p', { className: 'coii-attachment-note', role: 'status' }, 'Reading attachments…') : h(R.Fragment, null,
                  fitted.length ? fitted.map(option => row(option, true)) : h('p', { className: 'coii-attachment-note' }, 'Factory part fitted.'),
                  available.length ? available.map(option => row(option, false)) : h('p', { className: 'coii-attachment-note' }, 'No other compatible parts.'),
                  !editable && h('p', { className: 'coii-attachment-note' }, 'Move this weapon to your pockets to modify attachments.')),
                error && h('p', { className: 'coii-attachment-error', role: 'alert' }, error)));
          }));
      }
      function ItemInspection({ item, inventory, failed, onControls }) {
        const [details, setDetails] = R.useState({ loading: true }), [rotating, setRotating] = R.useState(false);
        const [zoom, setZoom] = R.useState(1);
        const [partsVisible, setPartsVisible] = R.useState(true);
        const art = R.useRef(null), session = R.useRef(null), drag = R.useRef(null);
        const angles = R.useRef({ yaw: 0, pitch: 0 }), rotationFrame = R.useRef(0);
        const zoomValue = R.useRef(1), zoomFrame = R.useRef(0);
        const zoomMin = .65, zoomMax = 2.5;
        const components = JSON.stringify(Array.isArray(item.metadata?.components) ? item.metadata.components.slice(0, 16) : []);
        const rectangle = () => {
          const rect = art.current.getBoundingClientRect();
          return { x: Math.max(0, rect.x / innerWidth), y: Math.max(0, rect.y / innerHeight), width: rect.width / innerWidth, height: rect.height / innerHeight };
        };
        const rotate = (yaw, pitch) => {
          angles.current = { yaw: ((yaw % 360) + 360) % 360, pitch: Math.max(-75, Math.min(75, pitch)) };
          if (!rotationFrame.current) rotationFrame.current = requestAnimationFrame(() => {
            rotationFrame.current = 0;
            if (session.current) fetchNui('coiiInspectRotate', { session: session.current, ...angles.current }).catch(() => {});
          });
        };
        const changeZoom = value => {
          const next = Math.max(zoomMin, Math.min(zoomMax, value));
          if (next === zoomValue.current) return;
          zoomValue.current = next;
          setZoom(zoomValue.current);
          if (!zoomFrame.current) zoomFrame.current = requestAnimationFrame(() => {
            zoomFrame.current = 0;
            if (session.current) fetchNui('coiiInspectZoom', { session: session.current, zoom: zoomValue.current }).catch(() => {});
          });
        };
        const reset = () => { rotate(0, 0); changeZoom(1); };
        R.useEffect(() => {
          onControls({ zoom, ready: Boolean(details.preview), reset, hasAttachments: Boolean(details.mounts?.length), attachmentsVisible: partsVisible, toggleAttachments: () => setPartsVisible(value => !value),
            zoomOut: () => changeZoom(zoomValue.current / 1.15), zoomIn: () => changeZoom(zoomValue.current * 1.15) });
        }, [zoom, details.preview, details.mounts, partsVisible, onControls]);
        R.useEffect(() => () => onControls(null), [onControls]);
        R.useEffect(() => {
          const node = art.current;
          const onWheel = event => {
            if (!details.preview || !event.deltaY) return;
            event.preventDefault(); event.stopPropagation();
            const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1);
            changeZoom(zoomValue.current * Math.exp(-Math.max(-120, Math.min(120, delta)) * .0015));
          };
          node.addEventListener('wheel', onWheel, { passive: false });
          return () => node.removeEventListener('wheel', onWheel);
        }, [details.preview]);
        useNuiEvent('coiiInspectLost', data => { if (data?.session === session.current) failed(); });
        R.useEffect(() => {
          let current = true, frameTimer;
          const token = `inspect-${Date.now()}-${++inspectionSequence}`;
          session.current = token; angles.current = { yaw: 0, pitch: 0 };
          zoomValue.current = 1; setZoom(1);
          setDetails({ loading: true });
          const updateFrame = () => { if (current && art.current) fetchNui('coiiInspectFrame', { session: token, frame: rectangle() }).catch(() => {}); };
          const observer = new ResizeObserver(updateFrame);
          observer.observe(art.current); window.addEventListener('resize', updateFrame);
          fetchNui('coiiInspect', { name: item.name, session: token, frame: rectangle(), components: JSON.parse(components) })
            .then(value => {
              if (!current) return;
              if (!value?.preview) { failed(); return; }
              setDetails(value); updateFrame();
            }).catch(() => { if (current) failed(); });
          frameTimer = setTimeout(updateFrame, 350);
          return () => {
            current = false; observer.disconnect(); window.removeEventListener('resize', updateFrame); clearTimeout(frameTimer);
            if (rotationFrame.current) cancelAnimationFrame(rotationFrame.current);
            if (zoomFrame.current) cancelAnimationFrame(zoomFrame.current);
            zoomFrame.current = 0;
            rotationFrame.current = 0; session.current = null;
            fetchNui('coiiInspectClose', { session: token }).catch(() => {});
          };
        }, [item.name]);
        R.useEffect(() => {
          if (!details.preview || !session.current || !item.name.startsWith('WEAPON_')) return;
          let current = true;
          fetchNui('coiiInspectComponents', { name: item.name, session: session.current, components: JSON.parse(components) })
            .then(value => { if (!current) return; if (value === false) { failed(); return; } if (value && typeof value === 'object') setDetails(previous => ({ ...previous, clipSize: value.clipSize })); })
            .catch(() => {});
          return () => { current = false; };
        }, [components, details.preview, item.name]);
        const weapon = details.weapon === true || definitions[item.name]?.weapon === true || item.name.startsWith('WEAPON_');
        const numeric = (value, digits = 0) => value != null && Number.isFinite(Number(value))
          ? Number(value).toLocaleString('en-GB', { maximumFractionDigits: digits }) : '—';
        const hasAmmo = item.metadata?.ammo != null && Number.isFinite(Number(item.metadata.ammo));
        const ammo = hasAmmo ? `${numeric(item.metadata.ammo)}${details.clipSize ? ` / ${numeric(details.clipSize)}` : ''}` : numeric(details.clipSize);
        const durability = Number(item.durability), description = item.metadata?.description || definitions[item.name]?.description;
        const stat = (name, value, note, title) => h('div', { className: 'coii-inspect-stat', key: name, title },
          h('dt', null, name), h('dd', { title: note }, value), h('small', null, note));
        return h('section', { className: `coii-inspect ${weapon ? 'is-weapon' : ''}`, 'aria-label': 'Item inspection', 'data-item': item.name },
          h('div', { className: 'coii-inspect-display' },
            h('div', { ref: art, className: `coii-inspect-art ${rotating ? 'is-rotating' : ''}`, tabIndex: 0, role: 'region', 'aria-label': '3D item preview. Drag or use arrow keys to rotate. Scroll or use plus and minus to zoom.',
              'aria-busy': Boolean(details.loading), 'data-preview': details.preview ? '3d' : 'loading',
              onPointerDown: event => { if (event.button !== 0 || !details.preview) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, ...angles.current }; setRotating(true); },
              onPointerMove: event => { const start = drag.current; if (start) rotate(start.yaw + (event.clientX - start.x) * .45, start.pitch + (event.clientY - start.y) * .35); },
              onPointerUp: () => { drag.current = null; setRotating(false); }, onPointerCancel: () => { drag.current = null; setRotating(false); }, onLostPointerCapture: () => { drag.current = null; setRotating(false); },
              onDoubleClick: reset,
              onKeyDown: event => {
                if (!details.preview) return;
                if (['Equal', 'NumpadAdd', 'Minus', 'NumpadSubtract'].includes(event.code)) { event.preventDefault(); changeZoom(zoomValue.current * (['Equal', 'NumpadAdd'].includes(event.code) ? 1.15 : 1 / 1.15)); }
                else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.code)) { event.preventDefault(); rotate(angles.current.yaw + (event.code === 'ArrowRight' ? 12 : event.code === 'ArrowLeft' ? -12 : 0), angles.current.pitch + (event.code === 'ArrowDown' ? 12 : event.code === 'ArrowUp' ? -12 : 0)); }
              }
            }, details.loading && h('span', { className: 'coii-inspect-loading', role: 'status' }, 'LOADING MODEL…'))),
          weapon && details.preview && details.mounts?.length > 0 && h(AttachmentEditor, { item, inventory, session, ready: Boolean(details.preview), mounts: details.mounts, visible: partsVisible }),
          h('article', { className: 'coii-inspect-info' },
            h('header', { className: 'coii-inspect-header' }, h(HeadingLines), h('span', { className: 'coii-inspect-eyebrow' }, weapon ? 'WEAPON DETAILS' : 'ITEM DETAILS'), h('h2', null, label(item))),
            h('div', { className: 'coii-inspect-body', id: 'coii-inspect-content' },
              h(R.Fragment, null,
              description && h('p', { className: 'coii-inspect-description' }, description),
              h('dl', { className: 'coii-inspect-weights' },
                stat('WEIGHT', `${kilograms(unitWeight(item, inventory.type))} KG`, 'PER ITEM'),
                stat('COUNT', numeric(item.count ?? 1), inventory.type === 'shop' ? 'AVAILABLE' : 'IN STACK'),
                Number(item.count ?? 1) > 1 && stat('TOTAL', `${kilograms(stackWeight(item, inventory.type))} KG`, 'STACK WEIGHT')),
              weapon && h('div', { className: 'coii-inspect-weapon', 'aria-busy': Boolean(details.loading) },
                h('dl', { className: 'coii-inspect-stats' },
                  stat('DAMAGE', numeric(details.damage, 1), 'BASE DAMAGE', 'Base weapon damage; hit location, armor and gameplay modifiers can change the result.'),
                  stat('AMMO', ammo, details.ammoLabel || (hasAmmo ? 'ROUNDS LOADED' : details.ammoName || 'NO AMMUNITION'), hasAmmo ? 'Loaded rounds / magazine capacity' : 'Magazine capacity'),
                  stat('FIRE RATE', numeric(details.fireRate), 'ROUNDS / MIN'),
                  stat('RECOIL', numeric(details.recoil, 3), 'CAMERA SHAKE', 'Weapon recoil shake amplitude')),
                details.loading && h('p', { className: 'coii-inspect-status', role: 'status' }, 'Reading weapon data…'),
                !details.loading && (details.unavailable || [details.damage, details.fireRate, details.recoil].some(value => value == null))
                  && h('p', { className: 'coii-inspect-status' }, '— Data unavailable for this weapon.')),
              Number.isFinite(durability) && item.durability != null && h('div', { className: 'coii-inspect-condition' },
                h('span', null, 'CONDITION'), h('b', null, `${numeric(Math.max(0, Math.min(100, durability)))}%`),
                h('div', { className: 'coii-inspect-condition-bar', role: 'progressbar', 'aria-label': 'Item condition', 'aria-valuemin': 0, 'aria-valuemax': 100,
                  'aria-valuenow': Math.max(0, Math.min(100, durability)) }, h('i', { style: { width: `${Math.max(0, Math.min(100, durability))}%` } }))),
              item.metadata?.serial && h('p', { className: 'coii-inspect-serial' }, h('span', null, 'SERIAL NUMBER'), h('b', null, String(item.metadata.serial))),
              !weapon && Array.isArray(item.metadata?.components) && item.metadata.components.length > 0 && h('div', { className: 'coii-inspect-attachments' },
                h('h3', null, 'ATTACHMENTS'), h('p', null, item.metadata.components.slice(0, 16).map(name => definitions[name]?.label || name).join(' · ')))))));
      }
      function useWheelMotion(stageRef, wheelRef) {
        R.useEffect(() => {
          const stage = stageRef.current, node = wheelRef.current;
          if (!stage || !node) return;
          const preference = matchMedia('(prefers-reduced-motion: reduce)');
          const reduceMotion = () => preference.matches || window.CoiiTheme?.get().tilt === false || window.CoiiTheme?.get().animations === false;
          let reduced = reduceMotion(), alive = true, held = false, dragging = false, frame = 0, previous = 0;
          let x = 0, y = 0, targetX = 0, targetY = 0, bounds;
          const stop = () => { if (frame) cancelAnimationFrame(frame); frame = 0; };
          const write = () => {
            node.style.setProperty('--coii-tilt-x', `${x.toFixed(3)}deg`);
            node.style.setProperty('--coii-tilt-y', `${y.toFixed(3)}deg`);
          };
          const reset = () => { stop(); x = y = targetX = targetY = 0; write(); };
          const measure = () => { bounds = stage.getBoundingClientRect(); reset(); };
          const blocked = () => reduced || held || dragging || !alive || !node.isConnected
            || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')
            || document.activeElement?.isContentEditable || document.querySelector('[role="menu"]')
            || document.body.classList.contains('inv-dragging') || node.closest('.coii-layout')?.matches('.is-busy,.is-inspecting');
          const tick = now => {
            frame = 0;
            if (blocked()) return;
            const blend = 1 - Math.exp(-Math.max(1, Math.min(48, now - previous)) / 80);
            previous = now;
            x += (targetX - x) * blend; y += (targetY - y) * blend;
            const settled = Math.abs(targetX - x) + Math.abs(targetY - y) < .004;
            if (settled) { x = targetX; y = targetY; }
            write();
            if (!settled) frame = requestAnimationFrame(tick);
          };
          const move = event => {
            if (blocked() || (event.pointerType && event.pointerType !== 'mouse')) { stop(); return; }
            const horizontal = Math.max(-1, Math.min(1, (event.clientX - bounds.x - bounds.width / 2) / (bounds.width * .65)));
            const vertical = Math.max(-1, Math.min(1, (event.clientY - bounds.y - bounds.height / 2) / (bounds.height * .65)));
            targetX = -vertical * 1.8; targetY = horizontal * 2.4;
            if (!frame && Math.abs(targetX - x) + Math.abs(targetY - y) < .004) return;
            if (!frame) { previous = performance.now(); frame = requestAnimationFrame(tick); }
          };
          const press = () => {
            held = true; stop();
            for (const animation of stage.getAnimations?.({ subtree: true }) || []) {
              if (animation.animationName?.startsWith('coii-open-')) animation.finish();
            }
          };
          const release = () => { held = false; };
          const startDrag = () => { dragging = true; stop(); };
          const endDrag = () => { dragging = false; held = false; };
          const focus = () => { if (blocked()) stop(); };
          const leave = event => { if (!event.relatedTarget && !held && !dragging) reset(); };
          const changePreference = () => { reduced = reduceMotion(); if (reduced) reset(); };
          const blur = () => { held = dragging = false; reset(); };
          measure();
          window.addEventListener('pointermove', move, { passive: true });
          window.addEventListener('pointerdown', press, true);
          window.addEventListener('pointerup', release, true);
          window.addEventListener('pointercancel', release, true);
          window.addEventListener('dragstart', startDrag, true);
          window.addEventListener('dragend', endDrag, true);
          window.addEventListener('drop', endDrag, true);
          window.addEventListener('focusin', focus, true);
          window.addEventListener('pointerout', leave);
          window.addEventListener('resize', measure);
          window.addEventListener('coii:theme', measure);
          window.addEventListener('coii:theme', changePreference);
          window.addEventListener('blur', blur);
          preference.addEventListener?.('change', changePreference);
          return () => {
            alive = false; stop();
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerdown', press, true);
            window.removeEventListener('pointerup', release, true);
            window.removeEventListener('pointercancel', release, true);
            window.removeEventListener('dragstart', startDrag, true);
            window.removeEventListener('dragend', endDrag, true);
            window.removeEventListener('drop', endDrag, true);
            window.removeEventListener('focusin', focus, true);
            window.removeEventListener('pointerout', leave);
            window.removeEventListener('resize', measure);
            window.removeEventListener('coii:theme', measure);
            window.removeEventListener('coii:theme', changePreference);
            window.removeEventListener('blur', blur);
            preference.removeEventListener?.('change', changePreference);
          };
        }, []);
      }
      function Chevron({ right }) { return h('svg', { viewBox: '0 0 20 24', width: '1em', height: '1em', 'aria-hidden': true }, h('path', { d: right ? 'M6 3l9 9-9 9' : 'M14 3l-9 9 9 9', fill: 'none', stroke: 'currentColor', strokeWidth: 3 })); }
      function TransferTab({ inventory, active, children, onClick, transfer, canTransfer, className = '', ...props }) {
        const [{ over }, connect] = useDrop(() => ({ accept: 'SLOT',
          canDrop: drag => canTransfer(drag, inventory),
          drop: drag => { transfer(drag, inventory); },
          collect: monitor => ({ over: monitor.isOver() && monitor.canDrop() })
        }), [inventory, transfer, canTransfer]);
        return h('button', { ...props, ref: connect, type: 'button', onClick, role: 'tab', 'aria-selected': active,
          className: `coii-wheel-tab ${active ? 'is-active' : ''} ${over ? 'is-over' : ''} ${className}` }, children);
      }
      function TransferAction({ inventory, selected, transfer, canTransfer, children, ...props }) {
        const [{ dragging, allowed, over }, connect] = useDrop(() => ({ accept: 'SLOT',
          canDrop: drag => canTransfer(drag, inventory),
          drop: drag => { transfer(drag, inventory); },
          collect: monitor => ({ dragging: monitor.getItemType() === 'SLOT', allowed: monitor.canDrop(), over: monitor.isOver() && monitor.canDrop() })
        }), [inventory, transfer, canTransfer]);
        const enabled = dragging ? allowed : Boolean(selected && canTransfer(selected, inventory));
        return h('button', { ...props, ref: connect, type: 'button', disabled: !enabled,
          onClick: () => { if (!dragging && selected) transfer(selected, inventory); },
          className: `coii-transfer-action ${dragging && allowed ? 'can-receive' : ''} ${over ? 'is-over' : ''}`,
          title: ['newdrop', 'drop'].includes(inventory.type) ? 'Drag an item here to drop it on the ground' : 'Drag an item here, or click to move the selected item' }, children);
      }
      function PageTarget({ targetPage, currentPage, inventory, visit, transfer, canTransfer, children, arrow, disabled, ...props }) {
        const [{ over, allowed }, connect] = useDrop(() => ({ accept: 'SLOT',
          canDrop: drag => Boolean(inventory) && canTransfer(drag, inventory),
          drop: drag => { if (inventory) transfer(drag, inventory); },
          collect: monitor => ({ over: monitor.isOver({ shallow: true }), allowed: monitor.canDrop() })
        }), [inventory, transfer, canTransfer]);
        R.useEffect(() => {
          if (!over || disabled || targetPage === currentPage) return;
          const timer = setTimeout(() => visit(targetPage), 500);
          return () => clearTimeout(timer);
        }, [over, disabled, targetPage, currentPage]);
        return h('button', { ...props, ref: connect, type: 'button', disabled, onClick: () => visit(targetPage),
          'aria-current': !arrow && targetPage === currentPage ? 'page' : undefined,
          className: `coii-page-target ${arrow ? 'is-arrow' : ''} ${over ? 'is-over' : ''} ${over && allowed ? 'can-receive' : ''}` }, children);
      }
      function WheelCell({ inventory, item, index, visible, active, onSelect, transfer, target }) {
        const [x, y] = polar(-90 + index * 45, 0.358);
        const price = inventory.type === 'shop' && item.price != null ? `${item.currency && item.currency !== 'money' ? '' : '$'}${compact(item.price)}${item.currency && item.currency !== 'money' ? ` ${definitions[item.currency]?.label || item.currency}` : ''}` : '';
        return h('div', { id: `wheel-${inventory.type}-${item.slot}`, className: `coii-wheel-cell ${visible ? 'is-visible' : ''} ${active ? 'is-active' : ''} ${present(item) ? 'has-item' : 'is-empty'}`,
          style: { clipPath: `url(#coii-sector-${index})`, '--item-x': `${x * 100}%`, '--item-y': `${y * 100}%`, '--coii-enter-order': index },
          'data-slot': item.slot, 'data-inventory': inventory.type, 'data-visible': visible ? 'true' : 'false',
          role: 'option', 'aria-selected': active, 'aria-hidden': !visible, 'aria-label': `${label(item) || 'Empty slot'} — slot ${item.slot}`,
          onMouseEnter: () => visible && present(item) && onSelect(item.slot),
          onMouseMove: () => visible && present(item) && !active && onSelect(item.slot),
          onMouseDownCapture: event => { if (visible && (event.button === 0 || event.button === 2)) onSelect(item.slot, true); },
          onClickCapture: event => { if (event.ctrlKey && present(item)) { event.stopPropagation(); transfer({ inventory: inventory.type, item }, target); } } },
          h(Slot, { item, inventoryType: inventory.type, inventoryId: inventory.id, inventoryGroups: inventory.groups }),
          h('span', { className: 'coii-wheel-index', 'aria-hidden': true }, index + 1),
          h('div', { className: 'coii-wheel-item' }, present(item)
            ? h(R.Fragment, null, h('img', { src: image(item), alt: '', draggable: false, onError: event => { event.currentTarget.style.visibility = 'hidden'; } }),
                h('div', { className: 'coii-wheel-item-meta' }, h('span', { className: 'coii-wheel-count' }, `${compact(item.count ?? 1)}x`),
                  h('span', { className: 'coii-wheel-item-weight', title: 'Weight per item' }, `${kilograms(unitWeight(item, inventory.type))} KG`)),
                h('span', { className: 'coii-wheel-label' }, label(item)),
                price && h('span', { className: 'coii-wheel-price' }, price),
                item.durability != null && h('span', { className: 'coii-wheel-durability' }, h('i', { style: { width: `${Math.max(0, Math.min(100, item.durability))}%` } })))
            : null));
      }
      function BackpackEquipment({ player, item, pack, busy, pockets, transfer, canTransfer, open }) {
        const presentBag = present(item), drag = { inventory: 'player', item };
        const capacity = Math.max(0, Number(item.metadata?.size?.[1] || pack.maxWeight) || 0);
        const weight = pack.id ? inventoryWeight(pack) : Math.max(0, Number(item.metadata?.weight) || 0);
        return h('aside', { className: `coii-backpack-equipment ${presentBag ? 'is-equipped' : ''}`, 'aria-label': 'Backpack equipment', 'data-equipment-slot': item.slot },
          h('div', { className: 'coii-backpack-slot', title: presentBag ? 'Drag to pockets to unequip' : 'Drag a backpack here to equip it' },
            !presentBag && h('svg', { viewBox: '0 0 40 44', 'aria-hidden': true }, h('path', { d: 'M15 9V7a5 5 0 0 1 10 0v2M10 17c0-5 3-8 10-8s10 3 10 8l2 18c.4 4-1.5 6-5 6H13c-3.5 0-5.4-2-5-6l2-18ZM14 25h12a2 2 0 0 1 2 2v8H12v-8a2 2 0 0 1 2-2ZM12 29h16m-3 0v3M9 20H7a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h1M31 20h2a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3h-1', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' })),
            h(Slot, { item, inventoryType: 'player', inventoryId: player.id }),
            presentBag && h('img', { src: image(item), alt: '', draggable: false })),
          h('div', { className: 'coii-backpack-info' }, h('span', { className: 'coii-equipment-eyebrow' }, presentBag ? 'EQUIPPED' : 'EQUIPMENT'),
            h('h2', null, presentBag ? label(item) : 'BACKPACK'),
            h('p', null, presentBag ? `${item.metadata?.size?.[0] || pack.slots || 0} SLOTS` : 'Drag a backpack here'),
            presentBag && h('p', { className: 'coii-backpack-weight', 'data-weight-grams': weight, 'data-capacity-grams': capacity }, `${kilograms(weight)} / ${kilograms(capacity)} KG`),
            presentBag && h(WeightBar, { weight, capacity, label: 'Backpack capacity', className: 'coii-backpack-progress' }),
            presentBag && h('div', { className: 'coii-backpack-actions' },
              h('button', { type: 'button', disabled: busy || !pack.id, onClick: open }, 'OPEN'),
              h('button', { type: 'button', disabled: !canTransfer(drag, pockets), onClick: () => transfer(drag, pockets) }, 'UNEQUIP'))));
      }
      function Layout() {
        const player = useSelector(getLeft), right = useSelector(getRight), pack = useSelector(state => state.inventory.packInventory || empty);
        const busy = useSelector(state => state.inventory.isBusy), amount = useSelector(state => state.inventory.itemAmount);
        const dispatch = useDispatch();
        const [profile, setProfile] = R.useState({ name: player.label || 'INVENTORY', id: player.id });
        const [view, setView] = R.useState(['newdrop', 'drop', ''].includes(right.type) ? 'pockets' : 'secondary');
        const [pages, setPages] = R.useState({}), [selections, setSelections] = R.useState({});
        const [error, setError] = R.useState('');
        const [inspection, setInspection] = R.useState(null);
        const [inspectControls, setInspectControls] = R.useState(null);
        const [opening, setOpening] = R.useState(true);
        R.useEffect(() => { const timer = setTimeout(() => setOpening(false), 2100); return () => clearTimeout(timer); }, []);
        const mounted = R.useRef(true), priorRight = R.useRef(right.id), refreshWhenIdle = R.useRef(false), wheel = R.useRef(null), stage = R.useRef(null), selectionLock = R.useRef(null), layout = R.useRef(null);
        useWheelMotion(stage, wheel);
        R.useLayoutEffect(() => {
          const root = layout.current;
          root?.focus({ preventScroll: true });
          return () => { if (root?.contains(document.activeElement)) document.activeElement.blur(); };
        }, []);
        const applyState = R.useCallback(data => {
          if (!data || !mounted.current) return;
          if (data.profile) setProfile(data.profile);
          if (data.config?.quickSlotStart) window.CoiiInventory.quickSlotStart = data.config.quickSlotStart;
          if (data.config?.backpackSlot) window.CoiiInventory.equipmentSlot = data.config.backpackSlot;
          if (data.config?.backpackItems) window.CoiiInventory.backpackItems = data.config.backpackItems;
          if (data.config?.accent) {
            if (window.CoiiTheme) window.CoiiTheme.setLegacyAccent(data.config.accent);
            else document.documentElement.style.setProperty('--coii-accent', data.config.accent);
          }
          if (Object.prototype.hasOwnProperty.call(data, 'backpack')) {
            if (store.getState().inventory.isBusy) refreshWhenIdle.current = true;
            else dispatch({ type: 'inventory/coiiBackpack', payload: data.backpack });
          }
        }, [dispatch]);
        useNuiEvent('coiiState', applyState);
        useNuiEvent('coiiFocusBackpack', () => { setView('pack'); });
        R.useEffect(() => {
          mounted.current = true;
          hoverEnabled = true;
          window.addEventListener('pointerdown', unlockHover, true);
          window.addEventListener('keydown', unlockHover, true);
          fetchNui('coiiPreview', { visible: false }).catch(() => {});
          fetchNui('coiiState', {}).then(applyState).catch(() => setError('Could not refresh your backpack. Reopen inventory.'));
          return () => {
            mounted.current = false; hoverEnabled = false; hoverPending = null;
            window.removeEventListener('pointerdown', unlockHover, true);
            window.removeEventListener('keydown', unlockHover, true);
            fetchNui('coiiPreview', { visible: false }).catch(() => {});
          };
        }, []);
        R.useEffect(() => {
          if (!busy && refreshWhenIdle.current) { refreshWhenIdle.current = false; fetchNui('coiiState', {}).then(applyState).catch(() => {}); }
        }, [busy, applyState]);
        R.useEffect(() => {
          if (priorRight.current !== right.id) {
            priorRight.current = right.id;
            setPages(value => ({ ...value, secondary: 0 })); setSelections(value => ({ ...value, secondary: null }));
            if (!['newdrop', 'drop', ''].includes(right.type)) setView('secondary');
          }
        }, [right.id, right.type]);
        const quickItems = window.CoiiInventory.quickItems(player), quickIds = new Set(quickItems.map(item => item.slot));
        const backpackSlot = window.CoiiInventory.backpackSlot(player);
        const backpackItem = player.items.find(item => item.slot === backpackSlot) || { slot: backpackSlot };
        const pockets = { ...player, slots: player.slots - quickItems.length - (backpackSlot ? 1 : 0), items: player.items.filter(item => !quickIds.has(item.slot) && item.slot !== backpackSlot) };
        const quick = { ...player, slots: quickItems.length, items: quickItems };
        const hasPack = Boolean(pack.id && pack.slots > 0 && backpackItem.metadata?.container === pack.id);
        const views = { pockets, pack, secondary: right, quick };
        const inventory = views[view] || pockets;
        const items = inventory.items || [], pageCount = Math.max(1, Math.ceil(items.length / 8));
        const page = Math.min(pages[view] || 0, pageCount - 1), visibleItems = items.slice(page * 8, page * 8 + 8);
        const candidate = visibleItems.find(item => item.slot === selections[view]) || visibleItems.find(present) || visibleItems[0];
        const lock = selectionLock.current;
        const selected = lock?.view === view && lock.id === inventory.id && candidate?.slot === lock.slot
          && present(candidate) && candidate.name !== lock.name ? undefined : candidate;
        const selectedIndex = selected ? visibleItems.indexOf(selected) : -1;
        const viewLabel = ({ pockets: 'POCKETS', pack: 'BACKPACK', quick: 'QUICK' })[view] || titleFor(right);
        const select = (slot, explicit = false) => {
          const held = selectionLock.current;
          const heldItem = held?.view === view && held.id === inventory.id && visibleItems.find(item => item.slot === held.slot);
          if (!explicit && present(heldItem) && heldItem.name === held.name) return;
          const item = items.find(value => value.slot === slot);
          selectionLock.current = explicit && present(item) ? { view, id: inventory.id, slot, name: item.name } : null;
          setSelections(value => value[view] === slot && !explicit && !held ? value : { ...value, [view]: slot });
        };
        const sourceFor = type => type === 'player' ? player : type === 'coii_pack' ? pack : right;
        const inspectInventory = inspection && sourceFor(inspection.inventory);
        const inspectItem = inspection && inspectInventory?.id === inspection.id && inspectInventory?.type === inspection.inventory
          ? inspectInventory.items?.find(item => item.slot === inspection.slot && sameInspectedItem(item, inspection) && window.CoiiInventory.canInspect(item)) : undefined;
        const closeInspection = () => { setInspection(null); setInspectControls(null); requestAnimationFrame(() => layout.current?.focus({ preventScroll: true })); };
        const openInspection = request => {
          if (busy || document.body.classList.contains('inv-dragging') || !request?.item) return;
          const target = sourceFor(request.inventory), item = target?.items?.find(value => value.slot === request.item.slot);
          const identity = { name: request.item.name, serial: request.item.metadata?.serial || '', container: request.item.metadata?.container || '' };
          if (!target || target.type !== request.inventory || target.id !== request.id || !sameInspectedItem(item, identity) || !window.CoiiInventory.canInspect(item)) return;
          dispatch(closeTooltip()); dispatch(closeContext());
          setError('');
          if (inspection?.id === target.id && inspection.inventory === target.type && inspection.slot === item.slot && sameInspectedItem(item, inspection)) return;
          setInspectControls(null);
          setInspection({ ...identity, inventory: target.type, id: target.id, slot: item.slot });
        };
        R.useEffect(() => {
          const inspect = event => openInspection(event.detail);
          window.addEventListener('coii:inspect', inspect);
          return () => window.removeEventListener('coii:inspect', inspect);
        });
        R.useEffect(() => { if (inspection && !inspectItem) closeInspection(); }, [inspection, inspectItem]);
        R.useEffect(() => { setInspection(null); }, [view, right.id, player.id]);
        const destinationFor = drag => drag.inventory === 'player' ? right : pockets;
        const targetSlot = (drag, target) => {
          const source = sourceFor(drag.inventory), item = source.items?.find(value => value.slot === drag.item.slot);
          if (!present(item) || item.count === 0 || !definitions[item.name] || !target?.items
            || !canAccess(item, { type: source.type, groups: source.groups }) || !canCraft(item, source.type)) return;
          if (item.metadata?.container && ['coii_pack', 'container'].includes(target.type)) return;
          return findSlot(item, definitions[item.name], target.items.filter(value => (source.type !== target.type || value.slot !== item.slot)
            && window.CoiiInventory.canDropSlot({ ...drag, item }, target.type, value.slot, value)));
        };
        const isPocketTarget = target => target?.type === 'player' && target.id === player.id
          && target.items.every(item => !quickIds.has(item.slot) && item.slot !== backpackSlot);
        const canTransfer = (drag, target) => !busy && Boolean(target && (target.type === 'newdrop' || target.id)) && !readOnly(target)
          && !(readOnly(sourceFor(drag.inventory)) && !isPocketTarget(target))
          && sourceFor(drag.inventory).type !== 'inspect' && Boolean(targetSlot(drag, target));
        const transfer = (drag, target) => {
          if (!canTransfer(drag, target)) return;
          const slot = targetSlot(drag, target), destination = { inventory: target.type, item: { slot: slot.slot } };
          dispatch(closeTooltip()); dispatch(closeContext());
          if (drag.inventory === 'shop') buyItem(drag, destination);
          else if (drag.inventory === 'crafting') craftItem(drag, destination);
          else move(drag, destination);
        };
        const currentDrag = selected && { inventory: inventory.type, item: selected };
        const primaryText = inventory.type === 'player' ? 'USE' : inventory.type === 'shop' ? 'BUY' : inventory.type === 'crafting' ? 'CRAFT' : 'TAKE';
        const primaryEnabled = !busy && present(selected) && selected.count !== 0 && inventory.type !== 'inspect'
          && canAccess(selected, { type: inventory.type, groups: inventory.groups }) && canCraft(selected, inventory.type)
          && (inventory.type === 'player' || canTransfer(currentDrag, pockets));
        const primary = () => { if (!primaryEnabled) return; dispatch(closeTooltip()); dispatch(closeContext()); if (inventory.type === 'player') useItem(selected); else transfer(currentDrag, pockets); };
        const give = () => { if (!busy && inventory.type === 'player' && present(selected)) giveItem(selected); };
        const secondaryEnabled = inventory.type === 'player' && canTransfer(currentDrag || { inventory: 'player', item: {} }, right);
        const dropText = ['drop', 'newdrop'].includes(right.type) ? 'DROP' : 'STORE';
        const visitPage = next => {
          if (next === page) return;
          selectionLock.current = null;
          setPages(value => ({ ...value, [view]: next })); setSelections(value => ({ ...value, [view]: null }));
        };
        const changePage = delta => visitPage((page + delta + pageCount) % pageCount);
        const transferDestinations = [
          ['pockets', pockets, 'POCKETS'],
          ...(!readOnly(right) ? [['secondary', right, titleFor(right)]] : []),
          ...(hasPack ? [['pack', pack, 'BACKPACK']] : [])
        ].filter(([key]) => key !== view && (!readOnly(inventory) || key === 'pockets'));
        const stepSelection = direction => {
          if (!items.length) return;
          const populated = items.filter(present), candidates = populated.length ? populated : items;
          const at = candidates.findIndex(item => item.slot === selected?.slot);
          const next = candidates[(Math.max(0, at) + direction + candidates.length) % candidates.length];
          setPages(value => ({ ...value, [view]: Math.floor(items.indexOf(next) / 8) })); select(next.slot, true);
        };
        R.useLayoutEffect(() => { selectionLock.current = null; }, [view, inventory.id]);
        R.useEffect(() => { if (view === 'pack' && !hasPack) setView('pockets'); }, [hasPack, view]);
        R.useEffect(() => { dispatch(closeTooltip()); dispatch(closeContext()); }, [view, page]);
        R.useEffect(() => {
          document.querySelector('.coii-page-strip [aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }, [view, page, pageCount]);
        R.useEffect(() => {
          const onWheel = event => { if (!event.deltaY || /INPUT|TEXTAREA|SELECT/.test(event.target?.tagName || '') || document.querySelector('[role="menu"]')) return; event.preventDefault(); stepSelection(event.deltaY > 0 ? 1 : -1); };
          const node = wheel.current; node?.addEventListener('wheel', onWheel, { passive: false });
          const onKey = event => {
            if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '') || document.querySelector('[role="menu"]')) return;
            if (event.code === 'KeyI' && !event.repeat) { event.preventDefault(); if (inspection) closeInspection(); else openInspection({ inventory: inventory.type, id: inventory.id, item: selected }); return; }
            if (inspection && event.code === 'KeyA' && !event.repeat) { event.preventDefault(); inspectControls?.toggleAttachments?.(); return; }
            if (inspection) return;
            if (event.code === 'KeyE' && !event.repeat) { event.preventDefault(); primary(); }
            else if (event.code === 'KeyG' && !event.repeat) { event.preventDefault(); give(); }
            else if (event.code === 'KeyR' && !event.repeat && secondaryEnabled) { event.preventDefault(); transfer(currentDrag, right); }
            else if (event.code === 'KeyQ' && !event.repeat) { event.preventDefault(); setView(value => value === 'quick' ? 'pockets' : 'quick'); }
            else if (event.code === 'PageDown' || event.code === 'ArrowRight') { event.preventDefault(); changePage(1); }
            else if (event.code === 'PageUp' || event.code === 'ArrowLeft') { event.preventDefault(); changePage(-1); }
            else if (event.code === 'Tab') { event.preventDefault(); const tabs = hasPack ? ['pockets', 'pack', 'secondary'] : ['pockets', 'secondary']; setView(tabs[(tabs.indexOf(view) + 1) % tabs.length]); }
            else if (/^Digit[1-8]$/.test(event.code)) { const item = visibleItems[Number(event.code.slice(-1)) - 1]; if (item) { event.preventDefault(); select(item.slot, true); } }
          };
          window.addEventListener('keydown', onKey);
          return () => { node?.removeEventListener('wheel', onWheel); window.removeEventListener('keydown', onKey); };
        });
        const description = selected?.metadata?.description || definitions[selected?.name]?.description || (!present(selected) ? 'Drag an item into this slot.' : '');
        return h('main', { ref: layout, tabIndex: -1, className: `coii-layout coii-wheel-layout ${opening ? 'is-opening' : ''} ${busy ? 'is-busy' : ''} ${inspectItem ? 'is-inspecting' : ''}`, 'aria-label': 'Inventory',
          onMouseOver: event => {
            const control = event.target?.closest?.('.coii-wheel-cell[data-visible="true"].has-item,button:not(:disabled)');
            if (busy || !control || !event.currentTarget.contains(control)
              || (event.relatedTarget?.nodeType && control.contains(event.relatedTarget))) return;
            playHover();
          } },
          h('header', { className: 'coii-profile' }, h(HeadingLines), h('span', { className: 'coii-profile-eyebrow' }, 'INVENTORY'),
            h('h1', null, profile.name || player.label || 'INVENTORY'), h(CarryWeight, { inventory: player })),
          backpackSlot > 0 && h(BackpackEquipment, { player, item: backpackItem, pack: hasPack ? pack : empty, busy, pockets, transfer, canTransfer, open: () => setView('pack') }),
          h('nav', { className: 'coii-wheel-tabs', role: 'tablist', 'aria-label': 'Inventory storage', onClickCapture: () => inspection && closeInspection() },
            h(TransferTab, { inventory: pockets, active: view === 'pockets', onClick: () => setView('pockets'), transfer, canTransfer, 'data-view': 'pockets' }, 'POCKETS'),
            hasPack && h(TransferTab, { inventory: pack, active: view === 'pack', onClick: () => setView('pack'), transfer, canTransfer, 'data-view': 'pack', title: `Backpack: ${capacityLabel(pack)}` }, 'BACKPACK'),
            h(TransferTab, { inventory: right, active: view === 'secondary', onClick: () => setView('secondary'), transfer, canTransfer, 'data-view': 'secondary',
              title: Number(right.maxWeight) > 0 ? `${titleFor(right)}: ${capacityLabel(right)}` : titleFor(right) }, titleFor(right))),
          inspectItem && h(ItemInspection, { key: `${inspection.id}:${inspection.slot}:${inspection.name}`, item: inspectItem, inventory: inspectInventory, onControls: setInspectControls,
            failed: () => { closeInspection(); setError('This item’s inspect model is unavailable.'); } }),
          h('div', { className: 'coii-wheel-stage', ref: stage, inert: Boolean(inspectItem), 'aria-hidden': Boolean(inspectItem) }, h('div', { className: 'coii-wheel-reveal' },
          h('section', { className: 'coii-wheel', ref: wheel, role: 'listbox', tabIndex: 0, 'aria-label': `${viewLabel} inventory`, 'aria-activedescendant': selected ? `wheel-${inventory.type}-${selected.slot}` : undefined,
            'data-view': view, 'data-page': page, 'data-slot-count': inventory.slots },
            h('svg', { className: 'coii-wheel-shape', viewBox: '0 0 1000 1000', 'aria-hidden': true },
              h('defs', null, Array.from({ length: 8 }, (_, index) => h('clipPath', { key: index, id: `coii-sector-${index}`, clipPathUnits: 'objectBoundingBox' }, h('path', { d: sector(index) }))),
                h('pattern', { id: 'coii-circle-lines', patternUnits: 'userSpaceOnUse', width: .48, height: .32 },
                  h('path', { d: 'M-.02 .25 .09 .07 .22 .35M.06-.06 .23 .13 .38-.04M.28 .36 .38 .11 .51 .25M.34-.02 .43 .08 .51 .04', className: 'coii-circle-linework' }))),
              h('g', { transform: 'scale(1000)' }, h('circle', { cx: 0.5, cy: 0.5, r: 0.231, className: 'coii-wheel-core' }), Array.from({ length: 8 }, (_, index) => h('path', { key: index, d: sector(index), style: { '--coii-enter-order': index }, className: `coii-wheel-wedge ${index === selectedIndex ? 'is-active' : ''} ${index >= visibleItems.length ? 'is-unavailable' : ''}`, vectorEffect: 'non-scaling-stroke' })),
                h('circle', { cx: .5, cy: .5, r: .498, className: 'coii-wheel-pattern', fill: 'url(#coii-circle-lines)' }),
                h('circle', { cx: .5, cy: .5, r: .499, className: 'coii-wheel-loading-ring', pathLength: 1, transform: 'rotate(-90 .5 .5)' }),
                selectedIndex >= 0 && h('path', { className: 'coii-wheel-accent', d: `M ${point(polar(-112.5 + selectedIndex * 45, 0.496))} A .496 .496 0 0 1 ${point(polar(-67.5 + selectedIndex * 45, 0.496))}`, vectorEffect: 'non-scaling-stroke' }))),
            items.map((item, index) => h(WheelCell, { key: `${inventory.id}:${item.slot}`, inventory, item, index: index % 8, visible: Math.floor(index / 8) === page, active: item === selected,
              onSelect: select, transfer, target: destinationFor({ inventory: inventory.type }) })),
            h('div', { className: 'coii-wheel-center' },
              h('h2', { style: label(selected).length > 22 ? { fontSize: 'calc(var(--wheel)*.042)' } : undefined, onMouseEnter: () => present(selected) && dispatch(openTooltip({ item: selected, inventoryType: inventory.type })), onMouseLeave: () => dispatch(closeTooltip()) }, label(selected) || 'EMPTY SLOT'),
              h('span', { className: 'coii-center-rule' }), description && h('p', { className: 'coii-item-description', title: description }, description),
              h('p', { className: 'coii-item-quantity' }, present(selected) ? `${Number(selected.count ?? 1).toLocaleString()} ${inventory.type === 'shop' ? 'AVAILABLE' : `IN ${viewLabel}`}` : `SLOT ${selected?.slot ?? '—'}`),
              present(selected) && h('p', { className: 'coii-selected-weight' }, h('span', { className: 'coii-selected-unit-weight' }, `${kilograms(unitWeight(selected, inventory.type))} KG EACH`),
                Number(selected.count ?? 1) > 1 && !catalogue(inventory.type) && h('span', { className: 'coii-selected-stack-weight' }, `${kilograms(stackWeight(selected, inventory.type))} KG TOTAL`)),
              present(selected) && h('button', { type: 'button', className: 'coii-primary-action', disabled: !primaryEnabled, onClick: primary }, h(Key, null, 'E'),
                h('span', { className: 'coii-action-label' }, primaryText, primaryText === 'TAKE' && h('small', null, 'TO POCKETS'))),
              inventory.type === 'player' && present(selected) && h('div', { className: 'coii-secondary-actions' },
                h('button', { type: 'button', disabled: busy, onClick: give }, h(Key, null, 'G'), ' GIVE'),
                secondaryEnabled && h('button', { type: 'button', onClick: () => transfer(currentDrag, right) }, h(Key, null, 'R'), ` ${dropText}`)),
              h('label', { className: 'coii-wheel-amount' }, 'AMOUNT', h('input', { type: 'number', min: 0, max: 999999, placeholder: ['shop', 'crafting'].includes(inventory.type) ? '1' : 'ALL', value: amount === 0 ? '' : amount,
                onChange: event => dispatch(setAmount(Math.max(0, Math.min(999999, Math.trunc(Number(event.target.value) || 0))))), 'aria-label': 'Transfer quantity' })))))),
          h('div', { className: 'coii-transfer-bar', 'aria-label': 'Move selected item', inert: Boolean(inspectItem), 'aria-hidden': Boolean(inspectItem) },
            h('span', { className: 'coii-transfer-caption' }, inventory.type === 'shop' ? 'BUY TO' : inventory.type === 'crafting' ? 'CRAFT TO' : 'MOVE TO'),
            transferDestinations.map(([key, destination, name]) => h(TransferAction, { key, inventory: destination, selected: currentDrag,
              transfer, canTransfer, 'data-target': key }, h(Chevron, { right: true }), name))),
          h('nav', { className: 'coii-wheel-pagination', 'aria-label': 'Inventory pages', inert: Boolean(inspectItem), 'aria-hidden': Boolean(inspectItem) },
            h('div', { className: 'coii-page-navigation' },
              h(PageTarget, { targetPage: (page + pageCount - 1) % pageCount, currentPage: page, visit: visitPage, arrow: true,
                disabled: pageCount === 1, transfer, canTransfer, 'aria-label': 'Previous page' }, h(Chevron)),
              h('div', { className: 'coii-page-strip' }, Array.from({ length: pageCount }, (_, index) => h(PageTarget, {
                key: index, targetPage: index, currentPage: page, inventory: { ...inventory, items: items.slice(index * 8, index * 8 + 8) },
                visit: visitPage, transfer, canTransfer, 'data-page-target': index, 'aria-label': `Page ${index + 1}`,
                title: `Drop an item onto page ${index + 1}, or hold to open it`
              }, String(index + 1).padStart(2, '0')))),
              h(PageTarget, { targetPage: (page + 1) % pageCount, currentPage: page, visit: visitPage, arrow: true,
                disabled: pageCount === 1, transfer, canTransfer, 'aria-label': 'Next page' }, h(Chevron, { right: true }))),
            h('div', { className: 'coii-page-caption' }, h('span', { className: 'coii-wheel-page-number' }, h('b', null, String(page + 1).padStart(2, '0')), ` / ${String(pageCount).padStart(2, '0')}`),
              h('span', null, 'DRAG TO PAGE · HOLD TO VIEW'))),
          h('footer', { className: 'coii-wheel-footer' },
            inspectItem ? h(InspectionHints, { controls: inspectControls, back: closeInspection })
            : h('div', { className: 'coii-hints' }, h('span', null, h(Key, null, h('svg', { viewBox: '0 0 18 28', 'aria-hidden': true }, h('rect', { x: 2, y: 1, width: 14, height: 25, rx: 6, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }), h('path', { d: 'M9 2v9M2 12h14', stroke: 'currentColor', strokeWidth: 1.5 }))), ' SCROLL SELECT'),
              h('span', null, h(Key, null, 'E'), ' ', primaryText), h('span', null, h(Key, null, 'RMB'), ' ACTIONS'),
              window.CoiiInventory.canInspect(selected) && h('button', { type: 'button', className: 'coii-inspect-toggle', disabled: busy, onClick: () => openInspection({ inventory: inventory.type, id: inventory.id, item: selected }) }, h(Key, null, 'I'), ' INSPECT'),
              quick.slots > 0 && h(TransferTab, { inventory: quick, active: view === 'quick', onClick: () => setView(value => value === 'quick' ? 'pockets' : 'quick'), transfer, canTransfer, 'data-view': 'quick', className: 'coii-quick-toggle' }, h(Key, null, 'Q'), ' QUICK'),
              h('button', { type: 'button', onClick: () => fetchNui('exit', {}) }, h(Key, null, 'ESC'), ' CLOSE'))),
          error && h('p', { className: 'coii-error', role: 'status' }, error));
      }
      window.CoiiInventory.runtime = runtime;
      return Layout;
    }
  };
})();
