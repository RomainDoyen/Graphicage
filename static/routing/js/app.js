/**
 * Graphicage TER — Application carte + optimisation OR-Tools
 */

(function () {
    'use strict';

    const config = window.GRAPHICAGE_CONFIG;
    const TYPE_COLORS = {
        depot: '#3b82f6',
        pickup: '#22c55e',
        delivery: '#ef4444',
        school: '#a855f7',
        stop: '#8fa3bc',
    };

    const TYPE_LABELS = {
        depot: 'Dépôt',
        pickup: 'Ramassage',
        delivery: 'Livraison',
        school: 'École',
        stop: 'Arrêt',
    };

    const ROUTE_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ef4444'];

    const TYPE_ICONS = {
        depot: 'warehouse',
        pickup: 'home',
        delivery: 'package',
        school: 'graduation-cap',
        stop: 'circle',
    };

    function icon(name, className = 'icon') {
        return `<i data-lucide="${name}" class="${className}" aria-hidden="true"></i>`;
    }

    function refreshIcons(root) {
        if (typeof lucide === 'undefined') {
            return;
        }
        lucide.createIcons({
            attrs: { 'stroke-width': '1.75' },
            nameAttr: 'data-lucide',
            ...(root ? { root } : {}),
        });
    }

    function removeButton(index) {
        return `<button type="button" class="point-remove" data-index="${index}" aria-label="Supprimer">${icon('x')}</button>`;
    }

    let map;
    let points = [];
    let markers = new Map();
    let routeLayers = [];
    let activeRoutesMeta = [];

    const GUIDE_STEP_ICONS = {
        points: 'map-pin-plus',
        types: 'tags',
        config: 'settings-2',
        solve: 'route',
    };

    const PROBLEM_TYPE_HINTS = {
        tsp: 'Visite tous les points dans l’ordre optimal. Idéal sans ramassage→école.',
        pdp: 'Transport scolaire : ramasse au domicile, dépose à l’école. Liez chaque ramassage.',
    };

    const els = {
        problemType: document.getElementById('problem-type'),
        numVehicles: document.getElementById('num-vehicles'),
        enableCapacity: document.getElementById('enable-capacity'),
        capacityField: document.getElementById('capacity-field'),
        vehicleCapacity: document.getElementById('vehicle-capacity'),
        enableTimeWindows: document.getElementById('enable-time-windows'),
        useDefaultTimeWindows: document.getElementById('use-default-time-windows'),
        defaultTwField: document.getElementById('default-tw-field'),
        useRoadRouting: document.getElementById('use-road-routing'),
        speedField: document.getElementById('speed-field'),
        averageSpeed: document.getElementById('average-speed'),
        btnLoadSample: document.getElementById('btn-load-sample'),
        btnImport: document.getElementById('btn-import'),
        btnExport: document.getElementById('btn-export'),
        btnDownloadTemplate: document.getElementById('btn-download-template'),
        importFile: document.getElementById('import-file'),
        btnClear: document.getElementById('btn-clear'),
        btnUndo: document.getElementById('btn-undo'),
        btnShare: document.getElementById('btn-share'),
        btnSaveScenario: document.getElementById('btn-save-scenario'),
        btnExportCsv: document.getElementById('btn-export-csv'),
        btnExportGpx: document.getElementById('btn-export-gpx'),
        btnPrint: document.getElementById('btn-print'),
        btnSetBaseline: document.getElementById('btn-set-baseline'),
        btnSolve: document.getElementById('btn-solve'),
        pointsList: document.getElementById('points-list'),
        pointCount: document.getElementById('point-count'),
        panelToggle: document.getElementById('panel-toggle'),
        panelToggleLabel: document.getElementById('panel-toggle-label'),
        detailsPanel: document.getElementById('details-panel'),
        panelMinimize: document.getElementById('panel-minimize'),
        tabButtons: document.querySelectorAll('.floating-tab'),
        tabPanels: document.querySelectorAll('.floating-tab-panel'),
        tabBtnResults: document.getElementById('tab-btn-results'),
        resultsEmpty: document.getElementById('results-empty'),
        resultsContent: document.getElementById('results-content'),
        toast: document.getElementById('toast'),
        legendPoints: document.getElementById('legend-points'),
        legendRoutes: document.getElementById('legend-routes'),
        legendRoutesSection: document.getElementById('legend-routes-section'),
        appLoader: document.getElementById('app-loader'),
        loaderDesc: document.getElementById('loader-desc'),
        placeSearchInput: document.getElementById('place-search-input'),
        placeSearchType: document.getElementById('place-search-type'),
        placeSearchResults: document.getElementById('place-search-results'),
        placeSearchStatus: document.getElementById('place-search-status'),
        guideSteps: document.querySelectorAll('.guide-step'),
        workflowStatus: document.getElementById('workflow-status'),
        toastMessage: document.querySelector('#toast .toast-message'),
        toastIcon: document.querySelector('#toast .toast-icon [data-lucide]'),
        toastClose: document.getElementById('toast-close'),
        schoolGroups: document.getElementById('school-groups'),
        resultsToolbar: document.getElementById('results-toolbar'),
        problemTypeHint: document.getElementById('problem-type-hint'),
        pointsListEmpty: document.getElementById('points-list-empty'),
        resultsHelp: document.getElementById('results-help'),
    };

    let hasResults = false;
    let mapInteractionState = null;
    let placeSearchTimer = null;
    let placeSearchRequestId = 0;
    let lastPlaceSearchResults = [];

    let lastSolveData = null;

    function getConfig() {
        return {
            problem_type: els.problemType.value,
            num_vehicles: Number(els.numVehicles.value) || 1,
            enable_capacity: els.enableCapacity.checked,
            vehicle_capacity: Number(els.vehicleCapacity.value) || 50,
            enable_time_windows: els.enableTimeWindows.checked,
            use_default_time_windows: els.useDefaultTimeWindows.checked,
            use_road_routing: els.useRoadRouting.checked,
            average_speed_kmh: Number(els.averageSpeed.value) || 30,
        };
    }

    function applyConfig(config = {}) {
        if (config.problem_type) els.problemType.value = config.problem_type;
        if (config.num_vehicles != null) els.numVehicles.value = config.num_vehicles;
        els.enableCapacity.checked = Boolean(config.enable_capacity);
        if (config.vehicle_capacity != null) els.vehicleCapacity.value = config.vehicle_capacity;
        els.enableTimeWindows.checked = Boolean(config.enable_time_windows);
        els.useDefaultTimeWindows.checked = config.use_default_time_windows !== false;
        els.useRoadRouting.checked = config.use_road_routing !== false;
        if (config.average_speed_kmh != null) els.averageSpeed.value = config.average_speed_kmh;
        toggleConstraintFields();
        updateProblemTypeHint();
    }

    function applyState(state) {
        if (!state) return;
        applyConfig(state.config || {});
        if (Array.isArray(state.points)) {
            applyPoints(state.points);
        }
        notifyStateChange();
    }

    function applyPoints(pointsData) {
        points = [];
        markers.forEach(m => map.removeLayer(m));
        markers.clear();
        clearRoutes();
        clearResults();

        pointsData.forEach((item, idx) => {
            const point = {
                id: idx,
                lat: item.lat,
                lng: item.lng,
                label: item.label || `Point ${idx}`,
                type: item.type || 'stop',
                demand: item.demand ?? 1,
            };
            if (item.school_id != null) point.school_id = item.school_id;
            if (item.time_window_start != null) point.time_window_start = item.time_window_start;
            if (item.time_window_end != null) point.time_window_end = item.time_window_end;
            points.push(point);
        });

        rebuildMarkers();
        renderPointsList();
        renderSchoolGroups();
    }

    function notifyStateChange() {
        GraphicageFeatures.onStateChange();
        renderSchoolGroups();
    }

    function getMarkerByIndex(index) {
        const point = points[index];
        return point ? markers.get(point.id) : null;
    }

    function reorderPoints(fromIndex, toIndex) {
        const [moved] = points.splice(fromIndex, 1);
        points.splice(toIndex, 0, moved);
        rebuildMarkers();
        renderPointsList();
        notifyStateChange();
    }

    function renderSchoolGroups() {
        if (!els.schoolGroups) return;
        els.schoolGroups.innerHTML = GraphicageFeatures.renderSchoolGroupsHtml(points, TYPE_LABELS);
        refreshIcons(els.schoolGroups);
    }

    function refreshResultsDisplay() {
        if (lastSolveData) displayResults(lastSolveData);
    }

    function updateProblemTypeHint() {
        const mode = els.problemType.value;
        const hasPickupSchool = points.some(p => p.type === 'pickup')
            || points.some(p => p.type === 'school');
        let hint = PROBLEM_TYPE_HINTS[mode] || '';
        if (mode === 'tsp' && hasPickupSchool) {
            hint = 'Vous avez des ramassages ou écoles : passez en mode Pickup & Delivery.';
            els.problemTypeHint.classList.add('is-warning');
        } else {
            els.problemTypeHint.classList.remove('is-warning');
        }
        els.problemTypeHint.textContent = hint;
    }

    function analyzeWorkflow() {
        const pickups = points.filter(p => p.type === 'pickup');
        const schools = points.filter(p => p.type === 'school');
        const depots = points.filter(p => p.type === 'depot');
        const problemType = els.problemType.value;
        const issues = [];

        if (points.length < 2) {
            issues.push('Ajoutez au moins 2 points (ex. dépôt + école).');
        }

        if (problemType === 'pdp') {
            if (!pickups.length) {
                issues.push('Mode PDP : ajoutez au moins un point « Ramassage ».');
            }
            if (!schools.length) {
                issues.push('Mode PDP : ajoutez au moins une « École ».');
            }
            const unlinked = pickups.filter(p => p.school_id == null);
            if (unlinked.length) {
                issues.push(`${unlinked.length} ramassage(s) sans école associée.`);
            }
        }

        if (problemType === 'tsp' && (pickups.length || schools.length)) {
            issues.push('Ramassages/écoles détectés : utilisez le mode Pickup & Delivery.');
        }

        if (els.enableCapacity.checked) {
            const capacity = Number(els.vehicleCapacity.value) || 50;
            const numVehicles = Number(els.numVehicles.value) || 1;
            pickups.forEach((pickup) => {
                const demand = pickup.demand ?? 1;
                if (demand > capacity) {
                    issues.push(
                        `« ${pickup.label} » : ${demand} élève(s) > ${capacity} places du bus.`
                    );
                }
            });
            const totalDemand = pickups.reduce((sum, p) => sum + (p.demand ?? 1), 0);
            if (totalDemand > capacity * numVehicles) {
                issues.push(
                    `Total ${totalDemand} élève(s) pour ${numVehicles} bus de ${capacity} places.`
                );
            }
        }

        if (!depots.length && points.length >= 2) {
            issues.push('Conseil : définissez un point « Dépôt » (départ du bus).');
        }

        const blocking = issues.filter(i => !i.startsWith('Conseil'));
        const ready = blocking.length === 0 && points.length >= 2;

        let currentStep = 'points';
        if (points.length >= 2) {
            currentStep = 'types';
        }
        const typeBlockers = blocking.filter(
            (i) => i.includes('ramassage') || i.includes('Ramassage')
                || i.includes('École') || i.includes('Pickup') || i.includes('TSP')
        );
        if (points.length >= 2 && typeBlockers.length === 0) {
            currentStep = 'config';
        }
        if (ready) {
            currentStep = 'solve';
        }

        return {
            currentStep,
            issues,
            blocking,
            ready,
            hasWarning: blocking.length === 0 && issues.length > 0,
        };
    }

    function updateWorkflowGuide() {
        const { currentStep, issues, blocking, ready } = analyzeWorkflow();

        els.guideSteps.forEach((stepEl) => {
            const step = stepEl.dataset.step;
            stepEl.classList.remove('is-current', 'is-done', 'is-warning');
            const order = ['points', 'types', 'config', 'solve'];
            const stepIndex = order.indexOf(step);
            const currentIndex = order.indexOf(currentStep);
            const isDone = stepIndex < currentIndex || (ready && step !== 'solve');
            if (isDone) {
                stepEl.classList.add('is-done');
            } else if (step === currentStep) {
                stepEl.classList.add('is-current');
                if (issues.length && !ready) {
                    stepEl.classList.add('is-warning');
                }
            }

            const iconEl = stepEl.querySelector('.guide-step-num [data-lucide]');
            if (iconEl) {
                iconEl.setAttribute('data-lucide', isDone ? 'check' : GUIDE_STEP_ICONS[step]);
            }
        });

        refreshIcons(document.getElementById('guide-steps'));

        if (!els.workflowStatus) return;

        els.workflowStatus.classList.remove('is-ready', 'is-warning', 'is-error');
        if (ready) {
            els.workflowStatus.textContent = 'Prêt : cliquez sur « Calculer l’itinéraire ».';
            els.workflowStatus.classList.add('is-ready');
        } else if (blocking.length) {
            els.workflowStatus.textContent = blocking[0];
            els.workflowStatus.classList.add('is-error');
        } else if (issues.length) {
            els.workflowStatus.textContent = issues[0];
            els.workflowStatus.classList.add('is-warning');
        } else {
            els.workflowStatus.textContent = 'Continuez la configuration…';
        }

        updateProblemTypeHint();
    }

    function validateBeforeSolve() {
        const { blocking, ready } = analyzeWorkflow();
        if (!ready && blocking.length) {
            return {
                ok: false,
                message: blocking[0],
                hints: blocking.slice(1),
            };
        }
        if (points.length < 2) {
            return { ok: false, message: 'Ajoutez au moins 2 points sur la carte.', hints: [] };
        }
        return { ok: true };
    }

    function showResultsHelp(title, hints) {
        if (!hints.length) {
            els.resultsHelp.hidden = true;
            els.resultsHelp.innerHTML = '';
            return;
        }
        els.resultsHelp.hidden = false;
        els.resultsHelp.innerHTML = `
            <h4>${escapeHtml(title)}</h4>
            <ul>${hints.map(h => `<li>${escapeHtml(h)}</li>`).join('')}</ul>
        `;
    }

    function clearResultsHelp() {
        els.resultsHelp.hidden = true;
        els.resultsHelp.innerHTML = '';
    }

    function buildErrorHints(errorMessage) {
        const hints = [];
        const msg = errorMessage.toLowerCase();

        if (msg.includes('capacité')) {
            hints.push('Réduisez le nombre d’élèves par ramassage ou augmentez « Places par bus ».');
            hints.push('Vous pouvez aussi augmenter le « Nombre de véhicules ».');
        }
        if (msg.includes('horaires') || msg.includes('fenêtres')) {
            hints.push('Élargissez les créneaux horaires (ex. +30 min).');
            hints.push('Vérifiez que l’école accepte les élèves après le ramassage.');
        }
        if (msg.includes('ramassage') || msg.includes('pickup') || msg.includes('pdp')) {
            hints.push('Passez en mode « Pickup & Delivery ».');
            hints.push('Associez chaque ramassage à une école dans la liste des points.');
        }
        if (els.problemType.value === 'tsp') {
            hints.push('Le mode TSP ignore les liens ramassage→école : essayez Pickup & Delivery.');
        }
        if (!hints.length) {
            hints.push('Consultez l’onglet Guide pour la marche à suivre.');
        }
        return [...new Set(hints)];
    }

    function updatePointCount() {
        const hiddenSchools = els.problemType.value === 'pdp'
            ? points.filter(p => p.type === 'school').length
            : 0;
        const count = String(points.length - hiddenSchools);
        els.pointCount.textContent = count;
        els.panelToggleLabel.textContent = `Points (${count})`;
    }

    function switchTab(tabName) {
        els.tabButtons.forEach(btn => {
            const isActive = btn.dataset.tab === tabName;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });

        els.tabPanels.forEach(panel => {
            const isActive = panel.id === `tab-${tabName}`;
            panel.classList.toggle('active', isActive);
            panel.hidden = !isActive;
        });
    }

    function minimizePanel() {
        els.detailsPanel.classList.add('is-minimized');
        els.panelToggle.hidden = false;
    }

    function expandPanel(tabName = 'points') {
        els.detailsPanel.classList.remove('is-minimized');
        els.panelToggle.hidden = true;
        switchTab(tabName);
        requestAnimationFrame(refreshMapSize);
    }

    function setLoading(isLoading, message) {
        document.body.classList.toggle('is-loading', isLoading);
        document.body.setAttribute('aria-busy', isLoading ? 'true' : 'false');

        if (isLoading) {
            els.loaderDesc.textContent = message || 'Optimisation en cours…';
            els.appLoader.hidden = false;
            els.appLoader.setAttribute('aria-hidden', 'false');
            if (map) {
                mapInteractionState = {
                    dragging: map.dragging.enabled(),
                    scrollWheelZoom: map.scrollWheelZoom.enabled(),
                    doubleClickZoom: map.doubleClickZoom.enabled(),
                    boxZoom: map.boxZoom.enabled(),
                    keyboard: map.keyboard.enabled(),
                };
                map.dragging.disable();
                map.scrollWheelZoom.disable();
                map.doubleClickZoom.disable();
                map.boxZoom.disable();
                map.keyboard.disable();
            }
        } else {
            els.appLoader.hidden = true;
            els.appLoader.setAttribute('aria-hidden', 'true');
            if (map && mapInteractionState) {
                if (mapInteractionState.dragging) map.dragging.enable();
                if (mapInteractionState.scrollWheelZoom) map.scrollWheelZoom.enable();
                if (mapInteractionState.doubleClickZoom) map.doubleClickZoom.enable();
                if (mapInteractionState.boxZoom) map.boxZoom.enable();
                if (mapInteractionState.keyboard) map.keyboard.enable();
                mapInteractionState = null;
            }
        }
    }

    function showToast(message, type = 'info') {
        const toastIcons = {
            success: 'circle-check',
            error: 'circle-alert',
            info: 'info',
        };

        if (els.toastMessage) {
            els.toastMessage.textContent = message;
        }
        if (els.toastIcon) {
            els.toastIcon.setAttribute('data-lucide', toastIcons[type] || toastIcons.info);
        }

        els.toast.hidden = false;
        els.toast.className = `toast visible ${type}`;
        refreshIcons(els.toast);
    }

    function getCsrfToken() {
        return config.csrfToken;
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function minutesToTime(minutes) {
        if (minutes == null || Number.isNaN(minutes)) return '';
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }

    function timeToMinutes(value) {
        if (value === '' || value == null) return null;
        const parts = String(value).split(':');
        if (parts.length !== 2) return null;
        return Number(parts[0]) * 60 + Number(parts[1]);
    }

    function getSchoolPoints() {
        return points.filter(p => p.type === 'school');
    }

    function isSchoolHiddenInList(point) {
        return els.problemType.value === 'pdp' && point.type === 'school';
    }

    function createIcon(type) {
        const color = TYPE_COLORS[type] || TYPE_COLORS.stop;
        return L.divIcon({
            className: 'custom-marker',
            html: `<div style="
                width:14px;height:14px;
                background:${color};
                border:2px solid #fff;
                border-radius:50%;
                box-shadow:0 2px 6px rgba(0,0,0,0.4);
            "></div>`,
            iconSize: [14, 14],
            iconAnchor: [7, 7],
        });
    }

    function buildSchoolOptions(selectedSchoolId) {
        const schools = getSchoolPoints();
        if (!schools.length) {
            return '<option value="">— Aucune école —</option>';
        }
        return schools.map(school => {
            const selected = school.id === selectedSchoolId ? 'selected' : '';
            return `<option value="${school.id}" ${selected}>${escapeHtml(school.label)}</option>`;
        }).join('');
    }

    function shortenLabel(label, type) {
        const prefixes = {
            depot: 'Dépôt bus — ',
            pickup: 'Domicile — ',
        };
        const prefix = prefixes[type];
        if (prefix && label.startsWith(prefix)) {
            return label.slice(prefix.length);
        }
        return label;
    }

    function buildPointExtraFields(point, index, showCapacity, showTimeWindows) {
        let extraFields = '';

        if (showCapacity && point.type === 'pickup') {
            extraFields += `
                <label class="point-extra">
                    <span>Élèves</span>
                    <input class="point-demand-input" data-index="${index}" type="number"
                           min="1" max="100" value="${point.demand ?? 1}">
                </label>`;
        }

        if (showTimeWindows) {
            extraFields += `
                <label class="point-extra">
                    <span>Créneau</span>
                    <span class="time-range">
                        <input class="point-tw-start" data-index="${index}" type="time"
                               value="${minutesToTime(point.time_window_start)}">
                        <span>${icon('arrow-right', 'icon icon-xs')}</span>
                        <input class="point-tw-end" data-index="${index}" type="time"
                               value="${minutesToTime(point.time_window_end)}">
                    </span>
                </label>`;
        }

        return extraFields
            ? `<div class="point-item-extra">${extraFields}</div>`
            : '';
    }

    function buildFlatPointRow(point, index, showCapacity, showTimeWindows) {
        let innerExtra = '';

        if (point.type === 'pickup') {
            innerExtra += `
                <label class="point-extra">
                    <span>École associée</span>
                    <select class="point-school-select" data-index="${index}">
                        ${buildSchoolOptions(point.school_id)}
                    </select>
                </label>`;
        }

        if (showCapacity && point.type === 'pickup') {
            innerExtra += `
                <label class="point-extra">
                    <span>Élèves</span>
                    <input class="point-demand-input" data-index="${index}" type="number"
                           min="1" max="100" value="${point.demand ?? 1}">
                </label>`;
        }

        if (showTimeWindows) {
            innerExtra += `
                <label class="point-extra">
                    <span>Créneau</span>
                    <span class="time-range">
                        <input class="point-tw-start" data-index="${index}" type="time"
                               value="${minutesToTime(point.time_window_start)}">
                        <span>${icon('arrow-right', 'icon icon-xs')}</span>
                        <input class="point-tw-end" data-index="${index}" type="time"
                               value="${minutesToTime(point.time_window_end)}">
                    </span>
                </label>`;
        }

        const extraBlock = innerExtra ? `<div class="point-item-extra">${innerExtra}</div>` : '';

        return `
            <div class="point-item-header">
                <span class="point-icon ${point.type}">${icon(TYPE_ICONS[point.type] || TYPE_ICONS.stop, 'icon icon-type')}</span>
                <span class="point-label" title="${escapeHtml(point.label)}">${escapeHtml(point.label)}</span>
                <div class="point-item-actions">
                    <select class="point-type-select" data-index="${index}" aria-label="Type du point">
                        ${Object.keys(TYPE_LABELS).map(t =>
                            `<option value="${t}" ${point.type === t ? 'selected' : ''}>${TYPE_LABELS[t]}</option>`
                        ).join('')}
                    </select>
                    ${removeButton(index)}
                </div>
            </div>
            ${extraBlock}
        `;
    }

    function buildDepotRow(point, index) {
        return `
            <div class="point-item-header point-item-header-compact">
                <span class="point-icon depot">${icon(TYPE_ICONS.depot, 'icon icon-type')}</span>
                <span class="point-label" title="${escapeHtml(point.label)}">${escapeHtml(shortenLabel(point.label, 'depot'))}</span>
                <span class="point-type-tag">${icon('warehouse', 'icon icon-xs')} Dépôt</span>
                ${removeButton(index)}
            </div>
        `;
    }

    function buildPickupPairRow(point, index, showCapacity, showTimeWindows) {
        const pickupLabel = shortenLabel(point.label, 'pickup');

        return `
            <div class="point-pair-header">
                <div class="point-pair-path">
                    <div class="point-pair-origin">
                        <span class="point-icon pickup">${icon(TYPE_ICONS.pickup, 'icon icon-type')}</span>
                        <span class="point-pair-label" title="${escapeHtml(point.label)}">${escapeHtml(pickupLabel)}</span>
                    </div>
                    <span class="point-pair-arrow" aria-hidden="true">${icon('arrow-right', 'icon icon-sm')}</span>
                    <div class="point-pair-dest">
                        <span class="point-icon school">${icon(TYPE_ICONS.school, 'icon icon-type')}</span>
                        <select class="point-school-select" data-index="${index}" aria-label="École de destination">
                            ${buildSchoolOptions(point.school_id)}
                        </select>
                    </div>
                </div>
                ${removeButton(index)}
            </div>
            ${buildPointExtraFields(point, index, showCapacity, showTimeWindows)}
        `;
    }

    function renderPointsList() {
        updatePointCount();
        els.pointsList.innerHTML = '';

        const showCapacity = els.enableCapacity.checked;
        const showTimeWindows = els.enableTimeWindows.checked;
        const isPdpList = els.problemType.value === 'pdp';
        let visibleCount = 0;

        els.pointsList.classList.toggle('points-list-pdp', isPdpList);

        points.forEach((point, index) => {
            if (isSchoolHiddenInList(point)) {
                return;
            }
            visibleCount += 1;

            const li = document.createElement('li');
            if (isPdpList && point.type === 'depot') {
                li.className = 'point-item point-item-depot';
                li.innerHTML = buildDepotRow(point, index);
            } else if (isPdpList && point.type === 'pickup') {
                li.className = 'point-item point-item-pair';
                li.innerHTML = buildPickupPairRow(point, index, showCapacity, showTimeWindows);
            } else {
                li.className = 'point-item';
                li.innerHTML = buildFlatPointRow(point, index, showCapacity, showTimeWindows);
            }
            els.pointsList.appendChild(li);
            GraphicageFeatures.decoratePointItem(li, index);
        });

        els.pointsListEmpty.hidden = points.length > 0 && visibleCount > 0;

        bindPointListEvents();
        GraphicageFeatures.setupDragDrop(els.pointsList, reorderPoints);
        refreshIcons(els.pointsList);
        updateWorkflowGuide();
    }

    function bindPointListEvents() {
        els.pointsList.querySelectorAll('.point-type-select').forEach(select => {
            select.addEventListener('change', (e) => {
                const idx = Number(e.target.dataset.index);
                points[idx].type = e.target.value;
                if (points[idx].type !== 'pickup') {
                    delete points[idx].school_id;
                } else if (getSchoolPoints().length === 1) {
                    points[idx].school_id = getSchoolPoints()[0].id;
                }
                updateMarker(idx);
                renderPointsList();
                notifyStateChange();
            });
        });

        els.pointsList.querySelectorAll('.point-school-select').forEach(select => {
            select.addEventListener('change', (e) => {
                const idx = Number(e.target.dataset.index);
                const value = e.target.value;
                points[idx].school_id = value === '' ? null : Number(value);
                updateWorkflowGuide();
                renderSchoolGroups();
                notifyStateChange();
            });
        });

        els.pointsList.querySelectorAll('.point-demand-input').forEach(input => {
            input.addEventListener('change', (e) => {
                const idx = Number(e.target.dataset.index);
                points[idx].demand = Math.max(1, Number(e.target.value) || 1);
                notifyStateChange();
            });
        });

        els.pointsList.querySelectorAll('.point-tw-start').forEach(input => {
            input.addEventListener('change', (e) => {
                const idx = Number(e.target.dataset.index);
                points[idx].time_window_start = timeToMinutes(e.target.value);
                notifyStateChange();
            });
        });

        els.pointsList.querySelectorAll('.point-tw-end').forEach(input => {
            input.addEventListener('change', (e) => {
                const idx = Number(e.target.dataset.index);
                points[idx].time_window_end = timeToMinutes(e.target.value);
                notifyStateChange();
            });
        });

        els.pointsList.querySelectorAll('.point-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                removePoint(Number(e.currentTarget.dataset.index));
            });
        });
    }

    function buildPopupContent(point) {
        const type = point.type || 'stop';
        const typeLabel = TYPE_LABELS[type] || type;
        let schoolRow = '';

        if (type === 'pickup' && point.school_id != null) {
            const school = points.find(p => p.id === point.school_id);
            if (school) {
                schoolRow = `
                    <div class="map-popup-row">
                        <dt>École de destination</dt>
                        <dd>${escapeHtml(school.label)}</dd>
                    </div>`;
            }
        }

        let demandRow = '';
        if (type === 'pickup' && point.demand != null) {
            demandRow = `
                <div class="map-popup-row">
                    <dt>Élèves</dt>
                    <dd>${point.demand}</dd>
                </div>`;
        }

        let timeRow = '';
        if (point.time_window_start != null && point.time_window_end != null) {
            timeRow = `
                <div class="map-popup-row">
                    <dt>Créneau horaire</dt>
                    <dd>${minutesToTime(point.time_window_start)} → ${minutesToTime(point.time_window_end)}</dd>
                </div>`;
        }

        return `
            <div class="map-popup">
                <div class="map-popup-header">
                    <span class="map-popup-badge ${type}">${escapeHtml(typeLabel)}</span>
                    <h3 class="map-popup-title">${escapeHtml(point.label)}</h3>
                </div>
                <dl class="map-popup-meta">
                    <div class="map-popup-row">
                        <dt>Coordonnées</dt>
                        <dd class="mono">${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}</dd>
                    </div>
                    ${schoolRow}
                    ${demandRow}
                    ${timeRow}
                </dl>
                <button type="button" class="map-popup-delete" data-point-id="${point.id}">
                    ${icon('trash-2', 'icon icon-sm')} Supprimer ce point
                </button>
            </div>
        `;
    }

    function attachMarkerPopup(marker) {
        marker.bindPopup('', {
            className: 'point-popup',
            maxWidth: 300,
            minWidth: 240,
        });

        marker.on('popupopen', () => {
            const index = marker._pointIndex;
            const point = points[index];
            if (!point) return;

            marker.setPopupContent(buildPopupContent(point));
            refreshIcons(marker.getPopup().getElement());

            const popupEl = marker.getPopup().getElement();
            const deleteBtn = popupEl?.querySelector('.map-popup-delete');
            if (deleteBtn) {
                deleteBtn.onclick = () => {
                    removePoint(index);
                    map.closePopup();
                };
            }
        });
    }

    function createMarkerForPoint(point, index) {
        const marker = L.marker([point.lat, point.lng], {
            icon: createIcon(point.type),
        }).addTo(map);
        marker._pointIndex = index;
        attachMarkerPopup(marker);
        return marker;
    }

    function initPointLegend() {
        els.legendPoints.innerHTML = Object.keys(TYPE_LABELS).map(type => `
            <li class="legend-item">
                <span class="point-icon ${type}">${icon(TYPE_ICONS[type] || TYPE_ICONS.stop, 'icon icon-type')}</span>
                <span>${TYPE_LABELS[type]}</span>
            </li>
        `).join('');
        refreshIcons(els.legendPoints);
    }

    function updateRouteLegend(routes) {
        activeRoutesMeta = routes || [];
        if (!activeRoutesMeta.length) {
            els.legendRoutesSection.hidden = true;
            els.legendRoutes.innerHTML = '';
            return;
        }

        els.legendRoutesSection.hidden = false;
        els.legendRoutes.innerHTML = activeRoutesMeta.map((route, idx) => {
            const color = ROUTE_COLORS[idx % ROUTE_COLORS.length];
            const dashed = idx > 0;
            const distance = formatDistance(route.distance_meters || 0);
            const duration = formatDuration(route.duration_minutes || 0);
            return `
                <li class="legend-item">
                    <span class="legend-line ${dashed ? 'dashed' : ''}"
                          style="color: ${color}; ${dashed ? '' : `background: ${color};`}"></span>
                    <span>Véhicule ${route.vehicle_id + 1} · ${escapeHtml(distance)} · ${escapeHtml(duration)}</span>
                </li>
            `;
        }).join('');
    }

    function updateMarker(index) {
        const point = points[index];
        const marker = markers.get(point.id);
        if (marker) {
            marker._pointIndex = index;
            marker.setIcon(createIcon(point.type));
            if (marker.isPopupOpen()) {
                marker.setPopupContent(buildPopupContent(point));
            }
        }
    }

    function rebuildMarkers() {
        markers.forEach(m => map.removeLayer(m));
        markers.clear();
        points.forEach((p, i) => {
            p.id = i;
            const marker = createMarkerForPoint(p, i);
            markers.set(p.id, marker);
        });
    }

    function addPoint(lat, lng, options = {}) {
        const id = options.id ?? points.length;
        const point = {
            id,
            lat,
            lng,
            label: options.label || `Point ${id}`,
            type: options.type || 'stop',
            demand: options.demand ?? 1,
        };

        if (options.school_id !== undefined) {
            point.school_id = options.school_id;
        }
        if (options.time_window_start != null) {
            point.time_window_start = options.time_window_start;
        }
        if (options.time_window_end != null) {
            point.time_window_end = options.time_window_end;
        }

        if (point.type === 'pickup' && point.school_id == null) {
            const schools = getSchoolPoints();
            if (schools.length === 1) {
                point.school_id = schools[0].id;
            }
        }

        if (
            els.enableTimeWindows.checked
            && els.useDefaultTimeWindows.checked
            && point.time_window_start == null
            && point.time_window_end == null
        ) {
            const tw = GraphicageFeatures.applyDefaultTimeWindows(point.type);
            if (tw) {
                point.time_window_start = tw[0];
                point.time_window_end = tw[1];
            }
        }

        points.push(point);

        const marker = createMarkerForPoint(point, points.length - 1);

        markers.set(point.id, marker);
        renderPointsList();
        renderSchoolGroups();
        if (!options.silent) {
            expandPanel('points');
            notifyStateChange();
        }
        return point;
    }

    function removePoint(index, options = {}) {
        const removed = points[index];
        if (!removed) return;

        if (!options.silent) {
            GraphicageFeatures.beforeRemovePoint(points);
        }

        points.splice(index, 1);
        rebuildMarkers();
        renderPointsList();
        renderSchoolGroups();
        clearRoutes();

        if (!options.silent) {
            showToast(`« ${removed.label} » supprimé`, 'info');
            notifyStateChange();
        }
    }

    function clearResults() {
        hasResults = false;
        lastSolveData = null;
        clearResultsHelp();
        els.resultsContent.innerHTML = '';
        els.resultsEmpty.hidden = false;
        els.tabBtnResults.classList.remove('has-result');
        if (els.resultsToolbar) els.resultsToolbar.hidden = true;
    }

    function clearAll(options = {}) {
        points = [];
        markers.forEach(m => map.removeLayer(m));
        markers.clear();
        clearRoutes();
        clearResults();
        renderPointsList();
        renderSchoolGroups();
        if (!options.silent) {
            notifyStateChange();
        }
    }

    function clearRoutes() {
        routeLayers.forEach(layer => map.removeLayer(layer));
        routeLayers = [];
        updateRouteLegend([]);
    }

    function buildPickupDeliveryPairs() {
        const pickups = points.filter(p => p.type === 'pickup');
        const missingSchool = pickups.filter(p => p.school_id == null);
        if (missingSchool.length) {
            throw new Error('Associez chaque ramassage à une école.');
        }

        return pickups.map(pickup => {
            const schoolIndex = points.findIndex(p => p.id === pickup.school_id);
            if (schoolIndex < 0) {
                throw new Error(`École introuvable pour « ${pickup.label} ».`);
            }
            if (points[schoolIndex].type !== 'school') {
                throw new Error(`Le point associé à « ${pickup.label} » n'est pas une école.`);
            }
            return [points.indexOf(pickup), schoolIndex];
        });
    }

    function getDepotIndex() {
        const depotIdx = points.findIndex(p => p.type === 'depot');
        return depotIdx >= 0 ? depotIdx : 0;
    }

    function buildPointPayload() {
        return points.map(p => {
            const payload = {
                id: p.id,
                lat: p.lat,
                lng: p.lng,
                label: p.label,
                type: p.type,
            };
            if (p.type === 'pickup') {
                payload.demand = p.demand ?? 1;
                if (p.school_id != null) {
                    payload.school_id = p.school_id;
                }
            }
            if (els.enableTimeWindows.checked) {
                if (p.time_window_start != null && p.time_window_end != null) {
                    payload.time_window_start = p.time_window_start;
                    payload.time_window_end = p.time_window_end;
                }
            }
            return payload;
        });
    }

    const VALID_POINT_TYPES = new Set(['depot', 'pickup', 'delivery', 'school', 'stop']);

    function downloadJsonFile(data, filename) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
    }

    function normalizeImportPayload(raw) {
        let items = raw;
        if (raw && !Array.isArray(raw) && Array.isArray(raw.points)) {
            items = raw.points;
        }
        if (!Array.isArray(items)) {
            throw new Error('Format invalide : attendu un tableau ou { "points": [...] }.');
        }
        if (items.length < 2) {
            throw new Error('Le fichier doit contenir au moins 2 points.');
        }
        if (items.length > 100) {
            throw new Error('Maximum 100 points par fichier.');
        }

        const normalized = items.map((item, index) => {
            if (item == null || typeof item !== 'object') {
                throw new Error(`Point ${index + 1} : objet invalide.`);
            }
            const lat = Number(item.lat);
            const lng = Number(item.lng);
            if (Number.isNaN(lat) || lat < -90 || lat > 90) {
                throw new Error(`Point ${index + 1} : latitude invalide.`);
            }
            if (Number.isNaN(lng) || lng < -180 || lng > 180) {
                throw new Error(`Point ${index + 1} : longitude invalide.`);
            }
            const type = item.type || 'stop';
            if (!VALID_POINT_TYPES.has(type)) {
                throw new Error(`Point ${index + 1} : type « ${type} » non reconnu.`);
            }

            const point = {
                id: item.id != null ? Number(item.id) : index,
                label: String(item.label || `Point ${index}`).trim() || `Point ${index}`,
                type,
                lat,
                lng,
            };

            if (item.address) point.address = String(item.address);
            if (item.demand != null) point.demand = Math.max(1, Number(item.demand) || 1);
            if (item.school_id != null) point.school_id = Number(item.school_id);
            if (item.time_window_start != null && item.time_window_end != null) {
                point.time_window_start = Number(item.time_window_start);
                point.time_window_end = Number(item.time_window_end);
            }
            return point;
        });

        const idMap = new Map();
        normalized.forEach((point, index) => {
            idMap.set(point.id, index);
            point.id = index;
        });
        normalized.forEach((point) => {
            if (point.school_id != null) {
                if (idMap.has(point.school_id)) {
                    point.school_id = idMap.get(point.school_id);
                } else {
                    delete point.school_id;
                }
            }
        });

        return normalized;
    }

    function loadPointsFromDataset(data, successMessage, focusTab = 'points') {
        clearAll();
        data.forEach((item) => {
            addPoint(item.lat, item.lng, {
                id: item.id,
                label: item.label,
                type: item.type,
                demand: item.demand,
                school_id: item.school_id,
                time_window_start: item.time_window_start,
                time_window_end: item.time_window_end,
            });
        });
        rebuildMarkers();
        if (points.length) {
            const bounds = L.latLngBounds(points.map(p => [p.lat, p.lng]));
            map.fitBounds(bounds, { padding: [40, 40] });
            requestAnimationFrame(refreshMapSize);
        }
        if (focusTab) {
            expandPanel(focusTab);
        }
        renderSchoolGroups();
        notifyStateChange();
        if (successMessage) {
            showToast(successMessage, 'success');
        }
    }

    async function loadSample() {
        try {
            const response = await fetch('/api/dataset/sample/');
            if (!response.ok) throw new Error('Impossible de charger l\'exemple.');
            const data = await response.json();
            loadPointsFromDataset(data, 'Exemple chargé — Saint-Denis, La Réunion');
        } catch (err) {
            showToast(err.message, 'error');
        }
    }

    function importFromFile(file) {
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
            try {
                const raw = JSON.parse(String(reader.result));
                const data = normalizeImportPayload(raw);
                loadPointsFromDataset(data, `${data.length} point(s) importé(s) depuis « ${file.name} »`);
            } catch (err) {
                showToast(err.message || 'Fichier JSON invalide.', 'error');
            } finally {
                els.importFile.value = '';
            }
        };
        reader.onerror = () => {
            showToast('Impossible de lire le fichier.', 'error');
            els.importFile.value = '';
        };
        reader.readAsText(file);
    }

    function exportPoints() {
        if (points.length === 0) {
            showToast('Aucun point à exporter.', 'error');
            return;
        }
        const payload = points.map((p) => {
            const item = {
                id: p.id,
                label: p.label,
                type: p.type,
                lat: p.lat,
                lng: p.lng,
            };
            if (p.demand != null) item.demand = p.demand;
            if (p.school_id != null) item.school_id = p.school_id;
            if (p.time_window_start != null && p.time_window_end != null) {
                item.time_window_start = p.time_window_start;
                item.time_window_end = p.time_window_end;
            }
            return item;
        });
        downloadJsonFile(payload, `graphicage-ter-${new Date().toISOString().slice(0, 10)}.json`);
        showToast(`${payload.length} point(s) exporté(s).`, 'success');
    }

    async function downloadImportTemplate() {
        try {
            const response = await fetch('/api/dataset/template/');
            if (!response.ok) throw new Error('Modèle indisponible.');
            const data = await response.json();
            downloadJsonFile(data, 'modele-import-graphicage-ter.json');
        } catch (err) {
            showToast(err.message, 'error');
        }
    }

    async function solveRoute() {
        const validation = validateBeforeSolve();
        if (!validation.ok) {
            showToast(validation.message, 'error');
            showResultsHelp('Corrigez avant de calculer :', [validation.message, ...validation.hints]);
            expandPanel('results');
            els.resultsEmpty.hidden = true;
            return;
        }

        const problemType = els.problemType.value;
        const numVehicles = Number(els.numVehicles.value) || 1;
        const payload = {
            problem_type: problemType,
            points: buildPointPayload(),
            num_vehicles: numVehicles,
            depot_index: getDepotIndex(),
            use_time_windows: els.enableTimeWindows.checked,
            use_road_routing: els.useRoadRouting.checked,
            average_speed_kmh: Number(els.averageSpeed.value) || 30,
        };

        if (els.enableCapacity.checked) {
            const capacity = Number(els.vehicleCapacity.value) || 50;
            payload.vehicle_capacities = Array(numVehicles).fill(capacity);
        }

        try {
            if (problemType === 'pdp') {
                payload.pickups_deliveries = buildPickupDeliveryPairs();
                if (!payload.pickups_deliveries.length) {
                    showToast('Mode PDP : ajoutez des points « Ramassage » et « École ».', 'error');
                    return;
                }
            }
        } catch (err) {
            showToast(err.message, 'error');
            return;
        }

        const loaderMessage = els.useRoadRouting.checked
            ? 'OR-Tools + routage OSRM en cours…'
            : 'Optimisation OR-Tools en cours…';
        setLoading(true, loaderMessage);
        clearResultsHelp();

        try {
            const response = await fetch('/api/route/solve/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken(),
                },
                body: JSON.stringify(payload),
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.detail || 'Erreur lors du calcul.');
            }

            displayResults(data);
            drawRoutes(data.routes);
            clearResultsHelp();
            const engineLabel = data.routing_engine === 'osrm' ? 'routes réelles' : 'vol d\'oiseau';
            showToast(`Itinéraire calculé (${engineLabel}) — ${formatDistance(data.objective_value)}`, 'success');
            if (typeof GraphicageAuth !== 'undefined') {
                GraphicageAuth.onRouteSaved();
            }
        } catch (err) {
            const hints = buildErrorHints(err.message);
            showResultsHelp('Aucune solution trouvée', [err.message, ...hints]);
            expandPanel('results');
            els.resultsEmpty.hidden = true;
            showToast(err.message, 'error');
        } finally {
            setLoading(false);
        }
    }

    function renderRouteStops(route, showTimes) {
        return route.points.map((stop, stepIndex) => {
            const type = stop.type || 'stop';
            const typeLabel = TYPE_LABELS[type] || type;
            const label = stop.label || `Point ${stop.index}`;
            const isLast = stepIndex === route.points.length - 1;
            const isReturn = isLast && stepIndex > 0 && stop.type === 'depot';

            return `
                <li class="route-stop ${isReturn ? 'route-stop-return' : ''}">
                    <div class="route-stop-marker" aria-hidden="true">
                        <span class="route-stop-dot ${type}"></span>
                        ${!isLast ? '<span class="route-stop-line"></span>' : ''}
                    </div>
                    <div class="route-stop-body">
                        <div class="route-stop-meta">
                            <span class="route-stop-step">#${stepIndex + 1}</span>
                            ${showTimes && stop.arrival_time
                                ? `<span class="route-stop-time">${escapeHtml(stop.arrival_time)}</span>`
                                : ''}
                            <span class="route-stop-badge ${type}">${escapeHtml(typeLabel)}</span>
                        </div>
                        <span class="route-stop-label">${escapeHtml(label)}</span>
                    </div>
                </li>
            `;
        }).join('');
    }

    function displayResults(data) {
        lastSolveData = data;
        GraphicageFeatures.setLastResult(data);
        hasResults = true;
        els.resultsEmpty.hidden = true;
        els.tabBtnResults.classList.add('has-result');
        if (els.resultsToolbar) els.resultsToolbar.hidden = false;
        expandPanel('results');
        const showLoad = els.enableCapacity.checked;
        const showTimes = els.enableTimeWindows.checked;
        const summaryHtml = GraphicageFeatures.renderSummaryHtml(data.summary);
        const baselineSummary = GraphicageFeatures.getBaselineResult()?.summary;
        const comparisonHtml = GraphicageFeatures.renderComparisonHtml(data.summary, baselineSummary);

        els.resultsContent.innerHTML = `
            ${summaryHtml}
            ${comparisonHtml}
            ${data.routing_engine === 'osrm'
                ? '<p class="results-engine">Distances, durées et tracé via le réseau routier OSRM (OpenStreetMap).</p>'
                : ''}
            ${data.routes.map((route, routeIdx) => {
            const routeColor = ROUTE_COLORS[routeIdx % ROUTE_COLORS.length];
            const stats = [
                `<span class="route-stat">${escapeHtml(formatDistance(route.distance_meters))}</span>`,
                `<span class="route-stat">${escapeHtml(route.duration_label || formatDuration(route.duration_minutes))}</span>`,
            ];
            if (showLoad && route.load != null) {
                stats.push(`<span class="route-stat">${route.load} élève(s) max</span>`);
            }
            stats.push(`<span class="route-stat">${route.points.length} arrêt(s)</span>`);

            return `
                <article class="route-card" style="--route-color: ${routeColor}">
                    <header class="route-card-header">
                        <h3><span class="route-color-dot" style="background:${routeColor}"></span> Véhicule ${route.vehicle_id + 1}</h3>
                        <div class="route-stats">${stats.join('')}</div>
                    </header>
                    <ol class="route-stops" aria-label="Séquence des arrêts">
                        ${renderRouteStops(route, showTimes)}
                    </ol>
                </article>
            `;
        }).join('')}`;
        refreshIcons(els.resultsContent);
    }

    function formatDistance(meters) {
        if (meters >= 1000) {
            return `${(meters / 1000).toFixed(2)} km`;
        }
        return `${meters} m`;
    }

    function formatDuration(minutes) {
        if (!minutes || minutes <= 0) return '0 min';
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        if (hours > 0) {
            return `${hours} h ${String(mins).padStart(2, '0')} min`;
        }
        return `${mins} min`;
    }

    function drawRoutes(routes) {
        clearRoutes();
        routes.forEach((route, idx) => {
            const latlngs = route.geometry && route.geometry.length >= 2
                ? route.geometry
                : route.points.map(p => [p.lat, p.lng]);
            const color = ROUTE_COLORS[idx % ROUTE_COLORS.length];
            const polyline = L.polyline(latlngs, {
                color,
                weight: 5,
                opacity: 0.88,
                dashArray: idx > 0 ? '8 6' : null,
            }).addTo(map);
            routeLayers.push(polyline);
        });
        updateRouteLegend(routes);
        if (routeLayers.length) {
            const group = L.featureGroup(routeLayers);
            map.fitBounds(group.getBounds(), { padding: [50, 50] });
        }
    }

    function toggleConstraintFields() {
        els.capacityField.hidden = !els.enableCapacity.checked;
        const osrmHandlesTime = els.useRoadRouting.checked && els.enableTimeWindows.checked;
        els.speedField.hidden = !els.enableTimeWindows.checked || osrmHandlesTime;
        if (els.defaultTwField) {
            els.defaultTwField.hidden = !els.enableTimeWindows.checked;
        }
        renderPointsList();
        updateWorkflowGuide();
        notifyStateChange();
    }

    function isPlaceOnMap(lat, lng) {
        return points.some(
            (p) => Math.abs(p.lat - lat) < 0.00005 && Math.abs(p.lng - lng) < 0.00005
        );
    }

    function setPlaceSearchStatus(message, isError = false) {
        if (!message) {
            els.placeSearchStatus.hidden = true;
            els.placeSearchStatus.textContent = '';
            els.placeSearchStatus.classList.remove('is-error');
            return;
        }
        els.placeSearchStatus.hidden = false;
        els.placeSearchStatus.textContent = message;
        els.placeSearchStatus.classList.toggle('is-error', isError);
    }

    function renderPlaceSearchResults(results) {
        els.placeSearchResults.innerHTML = '';

        if (!results.length) {
            els.placeSearchResults.hidden = true;
            return;
        }

        results.forEach((result) => {
            const onMap = isPlaceOnMap(result.lat, result.lng);
            const li = document.createElement('li');
            li.className = `place-search-item${onMap ? ' is-added' : ''}`;
            const typeLabel = TYPE_LABELS[result.type] || result.type;
            li.innerHTML = `
                <div class="place-search-info">
                    <span class="place-search-label" title="${escapeHtml(result.label)}">${escapeHtml(result.label)}</span>
                    ${result.subtitle
                        ? `<span class="place-search-subtitle" title="${escapeHtml(result.subtitle)}">${escapeHtml(result.subtitle)}</span>`
                        : ''}
                    <div class="place-search-meta">
                        <span class="place-search-type ${result.type}">${escapeHtml(typeLabel)}</span>
                    </div>
                </div>
                <button type="button" class="btn-place-add" ${onMap ? 'disabled' : ''}
                        data-place-id="${escapeHtml(result.id)}">
                    ${onMap ? 'Ajouté' : icon('plus', 'icon icon-sm')}
                </button>
            `;
            const btn = li.querySelector('.btn-place-add');
            btn.addEventListener('click', () => addPlaceFromSearch(result));
            els.placeSearchResults.appendChild(li);
        });

        els.placeSearchResults.hidden = false;
        refreshIcons(els.placeSearchResults);
    }

    function addPlaceFromSearch(result) {
        if (isPlaceOnMap(result.lat, result.lng)) {
            showToast('Ce lieu est déjà sur la carte.', 'info');
            return;
        }

        addPoint(result.lat, result.lng, {
            label: result.label,
            type: result.type,
        });
        map.panTo([result.lat, result.lng]);
        renderPlaceSearchResults(lastPlaceSearchResults || []);
        expandPanel('points');
        showToast(`« ${result.label} » ajouté`, 'success');
    }

    async function runPlaceSearch() {
        const query = els.placeSearchInput.value.trim();
        const placeType = els.placeSearchType.value;

        if (query.length < 2) {
            placeSearchRequestId += 1;
            els.placeSearchResults.hidden = true;
            els.placeSearchResults.innerHTML = '';
            setPlaceSearchStatus('');
            lastPlaceSearchResults = [];
            return;
        }

        const requestId = ++placeSearchRequestId;
        setPlaceSearchStatus('Recherche…');

        try {
            const params = new URLSearchParams({
                q: query,
                type: placeType,
                limit: '8',
            });
            const response = await fetch(`/api/places/search/?${params.toString()}`);
            const data = await response.json();

            if (requestId !== placeSearchRequestId) {
                return;
            }

            if (!response.ok) {
                throw new Error(data.detail || 'Recherche indisponible.');
            }

            const results = data.results || [];
            lastPlaceSearchResults = results;
            renderPlaceSearchResults(results);

            if (!results.length) {
                setPlaceSearchStatus('Aucun résultat à La Réunion.');
            } else {
                setPlaceSearchStatus(`${results.length} résultat(s)`);
            }
        } catch (err) {
            if (requestId !== placeSearchRequestId) {
                return;
            }
            lastPlaceSearchResults = [];
            renderPlaceSearchResults([]);
            setPlaceSearchStatus(err.message, true);
        }
    }

    function schedulePlaceSearch() {
        clearTimeout(placeSearchTimer);
        placeSearchTimer = setTimeout(runPlaceSearch, 350);
    }

    function bindPlaceSearchEvents() {
        els.placeSearchInput.addEventListener('input', schedulePlaceSearch);
        els.placeSearchType.addEventListener('change', () => {
            if (els.placeSearchInput.value.trim().length >= 2) {
                schedulePlaceSearch();
            }
        });
        els.placeSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                els.placeSearchInput.value = '';
                els.placeSearchResults.hidden = true;
                els.placeSearchResults.innerHTML = '';
                setPlaceSearchStatus('');
                lastPlaceSearchResults = [];
            }
        });
    }

    function initMap() {
        map = L.map('map').setView(config.mapCenter, config.mapZoom);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(map);

        map.on('click', (e) => {
            addPoint(e.latlng.lat, e.latlng.lng, {
                label: `Arrêt ${points.length}`,
                type: points.length === 0 ? 'depot' : 'pickup',
            });
        });

        requestAnimationFrame(() => map.invalidateSize());
    }

    function refreshMapSize() {
        if (map) {
            map.invalidateSize();
        }
    }

    function bindPanelEvents() {
        els.tabButtons.forEach(btn => {
            btn.addEventListener('click', () => switchTab(btn.dataset.tab));
        });

        els.panelMinimize.addEventListener('click', minimizePanel);
        els.panelToggle.addEventListener('click', () => expandPanel('points'));
    }

    function bindEvents() {
        els.btnLoadSample.addEventListener('click', loadSample);
        els.btnImport.addEventListener('click', () => els.importFile.click());
        els.importFile.addEventListener('change', (e) => {
            importFromFile(e.target.files?.[0]);
        });
        els.btnExport.addEventListener('click', exportPoints);
        els.btnDownloadTemplate.addEventListener('click', downloadImportTemplate);
        els.btnClear.addEventListener('click', clearAll);
        els.btnUndo?.addEventListener('click', () => GraphicageFeatures.undoLast());
        els.btnShare?.addEventListener('click', () => GraphicageFeatures.copyShareLink());
        els.btnSaveScenario?.addEventListener('click', () => {
            const defaultName = `Tournée ${new Date().toLocaleDateString('fr-FR')}`;
            const name = prompt('Nom de la tournée :', defaultName);
            if (name?.trim()) {
                GraphicageFeatures.saveScenarioToServer(name.trim());
            }
        });
        els.btnExportCsv?.addEventListener('click', () => GraphicageFeatures.exportCsv());
        els.btnExportGpx?.addEventListener('click', () => GraphicageFeatures.exportGpx());
        els.btnPrint?.addEventListener('click', () => GraphicageFeatures.printRouteSheet());
        els.btnSetBaseline?.addEventListener('click', () => GraphicageFeatures.setBaselineFromCurrent());
        els.btnSolve.addEventListener('click', solveRoute);
        els.problemType.addEventListener('change', () => {
            updateProblemTypeHint();
            renderPointsList();
            renderSchoolGroups();
            notifyStateChange();
        });
        els.numVehicles.addEventListener('change', () => {
            updateWorkflowGuide();
            notifyStateChange();
        });
        els.numVehicles.addEventListener('input', updateWorkflowGuide);
        els.vehicleCapacity.addEventListener('change', () => {
            updateWorkflowGuide();
            notifyStateChange();
        });
        els.vehicleCapacity.addEventListener('input', updateWorkflowGuide);
        els.enableCapacity.addEventListener('change', toggleConstraintFields);
        els.enableTimeWindows.addEventListener('change', toggleConstraintFields);
        els.useDefaultTimeWindows?.addEventListener('change', notifyStateChange);
        els.useRoadRouting.addEventListener('change', toggleConstraintFields);
        els.averageSpeed?.addEventListener('change', notifyStateChange);
        bindPlaceSearchEvents();
        bindPanelEvents();
    }

    initMap();
    initPointLegend();
    bindEvents();
    GraphicageFeatures.init({
        getPoints: () => points,
        getConfig,
        applyState,
        applyPoints,
        map,
        els,
        showToast,
        getCsrfToken,
        refreshResultsDisplay,
        getMarkerByIndex,
    });
    const appBridge = {
        getCsrfToken,
        showToast,
        applyState,
        displayResults,
        drawRoutes,
        expandPanel,
        refreshIcons,
        setLastResult: (data) => GraphicageFeatures.setLastResult(data),
    };
    GraphicageAuth.init(appBridge);
    GraphicageAuth.refresh();
    refreshIcons();
    updateProblemTypeHint();
    if (GraphicageFeatures.loadInitialState()) {
        if (points.length) {
            const bounds = L.latLngBounds(points.map(p => [p.lat, p.lng]));
            map.fitBounds(bounds, { padding: [40, 40] });
        }
    } else {
        renderPointsList();
    }
    renderSchoolGroups();
    updateWorkflowGuide();
    if (!localStorage.getItem('graphicage-ter-seen-guide')) {
        localStorage.setItem('graphicage-ter-seen-guide', '1');
        expandPanel('guide');
    }
})();
