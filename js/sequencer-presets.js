// ============================================================
// js/sequencer-presets.js — Menus déroulants "Rythmes" (Musicca) et
// "🎵 Presets" (Factory). Chargent grille + BPM + swing + label bouton.
// Persistance : 2 clés localStorage distinctes pour cohabitation.
//
// Données externes (fournies par les scripts vendor / statiques) :
//   - MUSICA_PRESETS, musicaToGrid, findMusicaPreset  (js/musicca-presets.js)
//   - FACTORY_PRESETS, findFactoryPreset              (js/factory-presets.js)
//
// Dépendances (fournies par le scope global de sequencer-app.js) :
//   - gridEl, applyGridToDOM, setBpm (sequencer-grid.js + sequencer-transport.js)
// ============================================================

// === Persistance du preset Rythmes actif ===
const STORAGE_PRESET_KEY = 'ytwm_activePreset';
function saveActivePreset(nameFr) {
    try { localStorage.setItem(STORAGE_PRESET_KEY, String(nameFr || '')); } catch (e) { /* ignore */ }
}
function loadActivePresetName() {
    try { return localStorage.getItem(STORAGE_PRESET_KEY) || ''; } catch (e) { return ''; }
}

// === Persistance du preset Factory d'usine actif ===
const STORAGE_FACTORY_KEY = 'ytwm_activeFactoryPreset';
function saveActiveFactoryPreset(id) {
    try { localStorage.setItem(STORAGE_FACTORY_KEY, String(id || '')); } catch (e) { /* ignore */ }
}
function loadActiveFactoryPresetId() {
    try { return localStorage.getItem(STORAGE_FACTORY_KEY) || ''; } catch (e) { return ''; }
}

function _applyBpmAndSwing(preset) {
    if (typeof setBpm === 'function') setBpm(preset.tempo);
    if (typeof Tone !== 'undefined' && Tone.Transport) {
        try {
            Tone.Transport.swing = preset.swing ? 0.3 : 0;
            Tone.Transport.swingSubdivision = '16n';
        } catch (e) { /* Tone <14 ignore */ }
    }
}

function loadMusiccaPreset(key) {
    if (typeof MUSICA_PRESETS === 'undefined' || typeof musicaToGrid === 'undefined') return null;
    const preset = findMusicaPreset(key);
    if (!preset) return null;
    const grid = musicaToGrid(preset);
    if (typeof applyGridToDOM === 'function') applyGridToDOM(grid);
    _applyBpmAndSwing(preset);
    const rythmesBtn = document.getElementById('rythmes-btn');
    if (rythmesBtn) rythmesBtn.textContent = preset.name_fr + ' ▾';
    saveActivePreset(preset.name_fr);
    document.querySelectorAll('#rythmes-menu .track-sound-menu-item').forEach((el) => {
        el.classList.toggle('active', el.dataset.preset === preset.name_fr);
    });
    return preset;
}

function initRythmesMenu() {
    const btn = document.getElementById('rythmes-btn');
    const menu = document.getElementById('rythmes-menu');
    const wrap = document.getElementById('rythmes-wrap');
    if (!btn || !menu || typeof MUSICA_PRESETS === 'undefined') return;

    function populateRythmesMenu() {
        menu.innerHTML = '';
        MUSICA_PRESETS.forEach((p) => {
            const isActive = btn.textContent.startsWith(p.name_fr);
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'track-sound-menu-item' + (isActive ? ' active' : '');
            item.dataset.preset = p.name_fr;
            item.setAttribute('role', 'option');
            item.textContent = (isActive ? '✓ ' : '○ ') + p.name_fr + '  · ' + p.tempo + ' BPM' + (p.swing ? ' · swing' : '') + ' · ' + p.rhythm;
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                loadMusiccaPreset(p.name_fr);
                closeMenu();
            });
            menu.appendChild(item);
        });
    }

    function closeMenu() {
        menu.hidden = true;
        btn.classList.remove('menu-open');
        btn.setAttribute('aria-expanded', 'false');
        document.removeEventListener('click', onDocClick, true);
        document.removeEventListener('keydown', onKey, true);
    }
    function onDocClick(ev) { if (!wrap.contains(ev.target)) closeMenu(); }
    function onKey(ev) { if (ev.key === 'Escape') closeMenu(); }

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.track-sound-menu').forEach((m) => { if (m !== menu) m.hidden = true; });
        document.querySelectorAll('.track-sound-toggle.menu-open').forEach((b) => { if (b !== btn) b.classList.remove('menu-open'); });
        const willOpen = menu.hidden;
        if (willOpen) {
            populateRythmesMenu();
            const r = btn.getBoundingClientRect();
            menu.style.position = 'fixed';
            menu.style.top = (r.bottom + 4) + 'px';
            menu.style.left = r.left + 'px';
            menu.style.minWidth = Math.max(r.width, 220) + 'px';
            menu.hidden = false;
            btn.classList.add('menu-open');
            btn.setAttribute('aria-expanded', 'true');
            setTimeout(() => {
                document.addEventListener('click', onDocClick, true);
                document.addEventListener('keydown', onKey, true);
            }, 0);
        } else {
            closeMenu();
        }
    });

    populateRythmesMenu();
}

function loadFactoryPreset(id) {
    if (typeof FACTORY_PRESETS === 'undefined') return null;
    const preset = findFactoryPreset(id);
    if (!preset) return null;
    if (typeof applyGridToDOM === 'function') applyGridToDOM(preset.pattern);
    _applyBpmAndSwing(preset);
    const btn = document.getElementById('factory-btn');
    if (btn) btn.textContent = preset.name_fr + ' ▾';
    saveActiveFactoryPreset(preset.id);
    document.querySelectorAll('#factory-menu .track-sound-menu-item').forEach((el) => {
        el.classList.toggle('active', el.dataset.preset === preset.id);
    });
    return preset;
}

function initFactoryPresetsMenu() {
    const btn = document.getElementById('factory-btn');
    const menu = document.getElementById('factory-menu');
    const wrap = document.getElementById('factory-wrap');
    if (!btn || !menu || typeof FACTORY_PRESETS === 'undefined') return;

    function populateFactoryMenu() {
        menu.innerHTML = '';
        FACTORY_PRESETS.forEach((p) => {
            const isActive = btn.textContent.startsWith(p.name_fr);
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'track-sound-menu-item' + (isActive ? ' active' : '');
            item.dataset.preset = p.id;
            item.setAttribute('role', 'option');
            item.textContent = (isActive ? '✓ ' : '○ ') + p.name_fr + '  · ' + p.tempo + ' BPM';
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                loadFactoryPreset(p.id);
                closeMenu();
            });
            menu.appendChild(item);
        });
    }

    function closeMenu() {
        menu.hidden = true;
        btn.classList.remove('menu-open');
        btn.setAttribute('aria-expanded', 'false');
        document.removeEventListener('click', onDocClick, true);
        document.removeEventListener('keydown', onKey, true);
    }
    function onDocClick(ev) { if (!wrap.contains(ev.target)) closeMenu(); }
    function onKey(ev) { if (ev.key === 'Escape') closeMenu(); }

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.track-sound-menu').forEach((m) => { if (m !== menu) m.hidden = true; });
        document.querySelectorAll('.track-sound-toggle.menu-open').forEach((b) => { if (b !== btn) b.classList.remove('menu-open'); });
        const willOpen = menu.hidden;
        if (willOpen) {
            populateFactoryMenu();
            const r = btn.getBoundingClientRect();
            menu.style.position = 'fixed';
            menu.style.top = (r.bottom + 4) + 'px';
            menu.style.left = r.left + 'px';
            menu.style.minWidth = Math.max(r.width, 220) + 'px';
            menu.hidden = false;
            btn.classList.add('menu-open');
            btn.setAttribute('aria-expanded', 'true');
            setTimeout(() => {
                document.addEventListener('click', onDocClick, true);
                document.addEventListener('keydown', onKey, true);
            }, 0);
        } else {
            closeMenu();
        }
    });

    populateFactoryMenu();
}

window.SEQUENCER_PRESETS = {
    saveActivePreset, loadActivePresetName,
    saveActiveFactoryPreset, loadActiveFactoryPresetId,
    loadMusiccaPreset, initRythmesMenu,
    loadFactoryPreset, initFactoryPresetsMenu,
};
