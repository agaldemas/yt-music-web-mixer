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
    // Cherche d'abord dans Musicca, sinon dans les presets utilisateur (même format).
    const preset = findMusicaPreset(key)
        || (typeof USER_PRESETS !== 'undefined' ? USER_PRESETS.findUserPreset(key) : null);
    if (!preset) return null;
    const grid = musicaToGrid(preset);
    if (typeof applyGridToDOM === 'function') applyGridToDOM(grid);
    _applyBpmAndSwing(preset);
    const rythmesBtn = document.getElementById('rythmes-btn');
    if (rythmesBtn) rythmesBtn.textContent = preset.name_fr + ' ▾';
    saveActivePreset(preset.id || preset.name_fr);
    document.querySelectorAll('#rythmes-menu .track-sound-menu-item').forEach((el) => {
        el.classList.toggle('active', el.dataset.preset === (preset.id || preset.name_fr));
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

        // 1. Presets utilisateur (s'ils existent) sous « ⭐ Mes rythmes »
        const userPresets = (typeof USER_PRESETS !== 'undefined') ? USER_PRESETS.loadUserPresets() : [];
        if (userPresets.length > 0) {
            const header = document.createElement('div');
            header.className = 'track-sound-menu-header';
            header.textContent = '⭐ Mes rythmes';
            menu.appendChild(header);

            userPresets.forEach((p) => {
                const isActive = btn.textContent.startsWith(p.name_fr);
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'track-sound-menu-item' + (isActive ? ' active' : '');
                item.dataset.preset = p.id;
                item.setAttribute('role', 'option');

                const label = document.createElement('span');
                label.textContent = (isActive ? '✓ ' : '○ ') + p.name_fr + '  · ' + p.tempo + ' BPM' + (p.swing ? ' · swing' : '');
                item.appendChild(label);

                const deleteBtn = document.createElement('span');
                deleteBtn.className = 'user-preset-delete';
                deleteBtn.textContent = '×';
                deleteBtn.title = 'Supprimer ce rythme';
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    if (confirm('Supprimer « ' + p.name_fr + ' » ?')) {
                        USER_PRESETS.deleteUserPreset(p.id);
                        populateRythmesMenu();
                    }
                });
                item.appendChild(deleteBtn);

                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    loadMusiccaPreset(p.id);
                    closeMenu();
                });
                menu.appendChild(item);
            });

            const sep = document.createElement('hr');
            sep.className = 'track-sound-menu-sep';
            menu.appendChild(sep);
        }

        // 2. Liste Musicca originale (20 items)
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

// === Sauvegarde du rythme courant (bouton 💾 + modale de nommage) ===
function initSavePresetUI() {
    const openBtn = document.getElementById('save-preset');
    const modal = document.getElementById('save-preset-modal');
    const input = document.getElementById('save-preset-name');
    const cancelBtn = document.getElementById('save-preset-cancel');
    const confirmBtn = document.getElementById('save-preset-confirm');
    const feedback = document.getElementById('save-preset-feedback');
    if (!openBtn || !modal || !input || !confirmBtn) return;

    function showFeedback(msg, isError) {
        if (!feedback) return;
        feedback.textContent = msg;
        feedback.className = 'save-preset-feedback ' + (isError ? 'error' : 'ok');
        feedback.hidden = false;
    }

    function openModal() {
        modal.hidden = false;
        if (feedback) feedback.hidden = true;
        input.value = '';
        setTimeout(() => input.focus(), 0);
    }
    function closeModal() { modal.hidden = true; }

    function doSave() {
        if (typeof USER_PRESETS === 'undefined' || typeof window.SEQUENCER_GRID === 'undefined') return;
        const name = input.value.trim().slice(0, 40);
        if (!name) { showFeedback('Nom requis', true); input.focus(); return; }
        window.SEQUENCER_GRID.syncPatternFromDOM();
        const bpmInput = document.getElementById('bpm');
        const bpm = (bpmInput && bpmInput.value) ? Number(bpmInput.value)
            : (typeof Tone !== 'undefined' && Tone.Transport ? Tone.Transport.bpm.value : 120);
        const swing = (typeof Tone !== 'undefined' && Tone.Transport) ? Tone.Transport.swing > 0 : false;
        const preset = USER_PRESETS.buildUserPreset(name, window.SEQUENCER_GRID.pattern, bpm, swing);
        const saved = USER_PRESETS.addUserPreset(preset);
        if (!saved) { showFeedback('Échec de la sauvegarde (stockage plein ?)', true); return; }
        showFeedback('Rythme « ' + name + ' » sauvegardé', false);
        // Le menu Rythmes se reconstruit au prochain clic (populateRythmesMenu).
        setTimeout(closeModal, 1200);
    }

    openBtn.addEventListener('click', (e) => { e.stopPropagation(); openModal(); });
    cancelBtn.addEventListener('click', (e) => { e.stopPropagation(); closeModal(); });
    confirmBtn.addEventListener('click', (e) => { e.stopPropagation(); doSave(); });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); doSave(); }
        if (e.key === 'Escape') { e.preventDefault(); closeModal(); }
    });
    modal.addEventListener('click', (e) => {
        if (!e.target.closest('.save-preset-dialog')) closeModal();
    });
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
    initSavePresetUI,
};
