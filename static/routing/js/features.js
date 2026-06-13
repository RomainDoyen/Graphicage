/**
 * Graphicage TER — fonctionnalités avancées (persistance, exports, UX)
 */
(function (global) {
    'use strict';

    const STORAGE_KEY = 'graphicage-ter-state-v1';
    const UNDO_LIMIT = 30;

    let undoStack = [];
    let baselineResult = null;
    let lastSolveResult = null;
    let bridge = null;

    function encodeShareState(state) {
        return btoa(unescape(encodeURIComponent(JSON.stringify(state))))
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    function decodeShareState(token) {
        const padded = token.replace(/-/g, '+').replace(/_/g, '/');
        const json = decodeURIComponent(escape(atob(padded)));
        return JSON.parse(json);
    }

    function getAppState() {
        if (!bridge) return null;
        return {
            points: bridge.getPoints(),
            config: bridge.getConfig(),
            baseline_result: baselineResult,
        };
    }

    function persistState() {
        const state = getAppState();
        if (!state) return;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (_) {
            /* quota */
        }
    }

    function loadPersistedState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return false;
            const state = JSON.parse(raw);
            bridge.applyState(state);
            if (state.baseline_result) baselineResult = state.baseline_result;
            return true;
        } catch (_) {
            return false;
        }
    }

    function loadShareFromUrl() {
        const hash = global.location.hash.match(/^#t=([A-Za-z0-9_-]+)/);
        if (!hash) return false;
        try {
            const state = decodeShareState(hash[1]);
            bridge.applyState(state);
            if (state.baseline_result) baselineResult = state.baseline_result;
            bridge.showToast('Tournée chargée depuis le lien de partage.', 'info');
            return true;
        } catch (_) {
            bridge.showToast('Lien de partage invalide.', 'error');
            return false;
        }
    }

    function copyShareLink() {
        const state = getAppState();
        if (!state || !state.points?.length) {
            bridge.showToast('Ajoutez des points avant de partager.', 'error');
            return;
        }
        const token = encodeShareState(state);
        const url = `${global.location.origin}${global.location.pathname}#t=${token}`;
        navigator.clipboard.writeText(url).then(() => {
            bridge.showToast('Lien de partage copié dans le presse-papier.', 'success');
        }).catch(() => {
            bridge.showToast(url, 'info');
        });
    }

    function pushUndo(snapshot) {
        undoStack.push(snapshot);
        if (undoStack.length > UNDO_LIMIT) undoStack.shift();
        updateUndoButton();
    }

    function undoLast() {
        if (!undoStack.length) return;
        const snapshot = undoStack.pop();
        bridge.applyPoints(snapshot.points);
        updateUndoButton();
        bridge.showToast('Annulation effectuée.', 'info');
    }

    function updateUndoButton() {
        if (bridge?.els.btnUndo) {
            bridge.els.btnUndo.disabled = undoStack.length === 0;
        }
    }

    function focusPointOnMap(index) {
        const point = bridge.getPoints()[index];
        if (!point || !bridge.map) return;
        bridge.map.setView([point.lat, point.lng], Math.max(bridge.map.getZoom(), 16), { animate: true });
        const marker = bridge.getMarkerByIndex(index);
        if (marker) marker.openPopup();
    }

    function applyDefaultTimeWindows(type) {
        const defaults = {
            pickup: [390, 450],
            school: [450, 480],
            depot: [360, 420],
        };
        return defaults[type] || null;
    }

    function buildGpx(routes) {
        const lines = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<gpx version="1.1" creator="Graphicage TER" xmlns="http://www.topografix.com/GPX/1/1">',
        ];
        routes.forEach((route, idx) => {
            lines.push(`  <trk><name>Véhicule ${route.vehicle_id + 1}</name><trkseg>`);
            const coords = route.geometry?.length >= 2
                ? route.geometry
                : route.points.map(p => [p.lat, p.lng]);
            coords.forEach(([lat, lng]) => {
                lines.push(`    <trkpt lat="${lat}" lon="${lng}"></trkpt>`);
            });
            lines.push('  </trkseg></trk>');
        });
        lines.push('</gpx>');
        return lines.join('\n');
    }

    function buildCsv(routes) {
        const rows = [['Véhicule', 'Ordre', 'Type', 'Label', 'Latitude', 'Longitude', 'Heure']];
        routes.forEach((route) => {
            route.points.forEach((stop, order) => {
                rows.push([
                    route.vehicle_id + 1,
                    order + 1,
                    stop.type || '',
                    `"${String(stop.label || '').replace(/"/g, '""')}"`,
                    stop.lat,
                    stop.lng,
                    stop.arrival_time || '',
                ]);
            });
        });
        return rows.map(r => r.join(',')).join('\n');
    }

    function downloadText(content, filename, mime) {
        const blob = new Blob([content], { type: mime });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
    }

    function exportGpx() {
        if (!lastSolveResult?.routes?.length) {
            bridge.showToast('Calculez un itinéraire avant d\'exporter le GPX.', 'error');
            return;
        }
        const date = new Date().toISOString().slice(0, 10);
        downloadText(buildGpx(lastSolveResult.routes), `graphicage-ter-${date}.gpx`, 'application/gpx+xml');
        bridge.showToast('GPX exporté.', 'success');
    }

    function exportCsv() {
        if (!lastSolveResult?.routes?.length) {
            bridge.showToast('Calculez un itinéraire avant d\'exporter le CSV.', 'error');
            return;
        }
        const date = new Date().toISOString().slice(0, 10);
        downloadText(buildCsv(lastSolveResult.routes), `graphicage-ter-${date}.csv`, 'text/csv');
        bridge.showToast('CSV exporté.', 'success');
    }

    function printRouteSheet() {
        if (!lastSolveResult?.routes?.length) {
            bridge.showToast('Calculez un itinéraire avant d\'imprimer.', 'error');
            return;
        }
        global.print();
    }

    function setBaselineFromCurrent() {
        if (!lastSolveResult) {
            bridge.showToast('Calculez d\'abord un itinéraire de référence.', 'error');
            return;
        }
        baselineResult = structuredClone(lastSolveResult);
        persistState();
        bridge.showToast('Référence « avant » enregistrée pour comparaison.', 'success');
        bridge.refreshResultsDisplay();
    }

    function renderComparisonHtml(summary, baselineSummary) {
        if (!baselineSummary) return '';
        const deltaDist = summary.total_distance_meters - baselineSummary.total_distance_meters;
        const deltaDur = summary.total_duration_minutes - baselineSummary.total_duration_minutes;
        const sign = (n) => (n > 0 ? '+' : '');
        return `
            <div class="results-comparison">
                <h4>Comparaison avec la référence</h4>
                <ul>
                    <li>Distance : ${sign(deltaDist)}${Math.round(deltaDist)} m</li>
                    <li>Durée : ${sign(deltaDur)}${deltaDur} min</li>
                </ul>
            </div>`;
    }

    function renderSummaryHtml(summary) {
        if (!summary) return '';
        return `
            <div class="results-summary">
                <h4>Résumé de la tournée</h4>
                <div class="results-summary-grid">
                    <div class="summary-stat"><span>Distance</span><strong>${summary.total_distance_label}</strong></div>
                    <div class="summary-stat"><span>Durée</span><strong>${summary.total_duration_label}</strong></div>
                    <div class="summary-stat"><span>Arrêts</span><strong>${summary.total_stops}</strong></div>
                    <div class="summary-stat"><span>Véhicules</span><strong>${summary.vehicle_count}</strong></div>
                    <div class="summary-stat"><span>Charge max</span><strong>${summary.max_load} élève(s)</strong></div>
                    <div class="summary-stat"><span>Carburant ~</span><strong>${summary.fuel_liters_estimate} L</strong></div>
                    <div class="summary-stat"><span>CO₂ ~</span><strong>${summary.co2_kg_estimate} kg</strong></div>
                </div>
            </div>`;
    }

    function renderSchoolGroupsHtml(points, typeLabels) {
        const schools = points.filter(p => p.type === 'school');
        const pickups = points.filter(p => p.type === 'pickup');
        if (!schools.length && !pickups.length) {
            return '<p class="school-groups-empty">Aucun ramassage ni école pour le moment.</p>';
        }
        const groups = schools.map(school => {
            const linked = pickups.filter(p => p.school_id === school.id);
            const items = linked.map(p => `<li>${escapeHtml(p.label)}</li>`).join('')
                || '<li class="muted">Aucun ramassage lié</li>';
            return `
                <article class="school-group-card">
                    <header><span class="point-icon school"><i data-lucide="graduation-cap" class="icon icon-type"></i></span>
                    <strong>${escapeHtml(school.label)}</strong></header>
                    <ul>${items}</ul>
                </article>`;
        });
        const unlinked = pickups.filter(p => p.school_id == null);
        if (unlinked.length) {
            groups.push(`
                <article class="school-group-card is-warning">
                    <header><strong>Ramassages sans école</strong></header>
                    <ul>${unlinked.map(p => `<li>${escapeHtml(p.label)}</li>`).join('')}</ul>
                </article>`);
        }
        return groups.join('');
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    async function saveScenarioToServer(name) {
        if (!bridge.getCsrfToken) return;
        const state = getAppState();
        if (!state?.points?.length) {
            bridge.showToast('Aucun point à enregistrer.', 'error');
            return;
        }
        if (global.GraphicageAuth && !global.GraphicageAuth.isAuthenticated()) {
            bridge.showToast('Connectez-vous pour enregistrer une tournée.', 'error');
            return;
        }
        try {
            const response = await fetch('/api/scenarios/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': bridge.getCsrfToken(),
                },
                body: JSON.stringify({
                    name,
                    config: state.config,
                    points: state.points,
                    baseline_result: baselineResult,
                    last_result: lastSolveResult,
                    is_public: false,
                }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.detail || 'Erreur serveur.');
            bridge.showToast(`Tournée « ${data.name} » enregistrée.`, 'success');
        } catch (err) {
            bridge.showToast(err.message, 'error');
        }
    }

    function setupDragDrop(listEl, onReorder) {
        let dragIndex = null;
        listEl.querySelectorAll('.point-item').forEach((item) => {
            item.draggable = true;
            item.addEventListener('dragstart', (e) => {
                dragIndex = Number(item.dataset.index);
                item.classList.add('is-dragging');
                e.dataTransfer.effectAllowed = 'move';
            });
            item.addEventListener('dragend', () => {
                item.classList.remove('is-dragging');
                dragIndex = null;
            });
            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                item.classList.add('is-drag-over');
            });
            item.addEventListener('dragleave', () => item.classList.remove('is-drag-over'));
            item.addEventListener('drop', (e) => {
                e.preventDefault();
                item.classList.remove('is-drag-over');
                const dropIndex = Number(item.dataset.index);
                if (dragIndex == null || dragIndex === dropIndex) return;
                onReorder(dragIndex, dropIndex);
            });
        });
    }

    function setupToastDismiss(els) {
        els.toastClose?.addEventListener('click', () => {
            els.toast.hidden = true;
            els.toast.classList.remove('visible');
        });
    }

    global.GraphicageFeatures = {
        init(api) {
            bridge = api;
            setupToastDismiss(api.els);
            updateUndoButton();
        },
        persistState,
        loadInitialState() {
            if (loadShareFromUrl()) return true;
            return loadPersistedState();
        },
        onStateChange() {
            persistState();
        },
        beforeRemovePoint(points) {
            pushUndo({ points: structuredClone(points) });
        },
        undoLast,
        focusPointOnMap,
        copyShareLink,
        exportGpx,
        exportCsv,
        printRouteSheet,
        setBaselineFromCurrent,
        saveScenarioToServer,
        applyDefaultTimeWindows,
        setLastResult(data) {
            lastSolveResult = data;
            persistState();
        },
        getLastResult: () => lastSolveResult,
        getBaselineResult: () => baselineResult,
        renderSummaryHtml,
        renderComparisonHtml,
        renderSchoolGroupsHtml,
        setupDragDrop,
        decoratePointItem(li, index) {
            li.dataset.index = String(index);
            li.classList.add('point-item-draggable');
            li.querySelector('.point-label, .point-pair-label')?.addEventListener('click', () => {
                focusPointOnMap(index);
            });
        },
    };
}(window));
