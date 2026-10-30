(function () {
    const stage = document.getElementById('tour-panel');
    const mapEl = document.getElementById('landing-tour-map');
    const tabs = Array.from(document.querySelectorAll('[data-tour-step]'));
    const demo = window.GraphicageDemo;
    if (!stage || !mapEl || tabs.length === 0 || !demo || !window.L) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const DWELL_MS = 4800;
    const DRAW_MS = 1600;
    let index = 0;
    let held = false;
    let visible = false;
    let timer = 0;
    let drawToken = 0;
    let markerTimers = [];

    const map = L.map(mapEl, {
        attributionControl: true,
        zoomControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
        tap: false,
        touchZoom: false,
    });

    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap',
    });
    tiles.createTile = function (tileCoords, done) {
        const tile = document.createElement('img');
        tile.referrerPolicy = 'strict-origin-when-cross-origin';
        tile.alt = '';
        L.DomEvent.on(tile, 'load', L.Util.bind(this._tileOnLoad, this, done, tile));
        L.DomEvent.on(tile, 'error', L.Util.bind(this._tileOnError, this, done, tile));
        tile.src = this.getTileUrl(tileCoords);
        return tile;
    };
    tiles.addTo(map);

    const line = L.polyline(demo.route, {
        color: '#3b82f6',
        weight: 5,
        opacity: 0,
        lineCap: 'round',
        lineJoin: 'round',
    }).addTo(map);

    const placed = demo.stops.map(function (stop) {
        const marker = L.marker(stop.at, {
            interactive: false,
            keyboard: false,
            icon: L.divIcon({
                className: 'landing-stop-marker',
                html: '<span class="point-icon ' + stop.kind + '"><i data-lucide="' + stop.icon + '" class="icon icon-type" aria-hidden="true"></i></span>',
                iconSize: [32, 32],
                iconAnchor: [16, 16],
            }),
        }).addTo(map);
        marker.bindTooltip(stop.label, {
            permanent: true,
            direction: stop.dir,
            className: 'landing-map-tip',
            offset: demo.tipOffset[stop.dir],
        });
        return marker;
    });

    function fitMap() {
        map.invalidateSize();
        map.fitBounds(line.getBounds(), { padding: [36, 36] });
    }

    fitMap();
    if (window.lucide) {
        window.lucide.createIcons({
            attrs: { 'stroke-width': '1.75', 'aria-hidden': 'true' },
        });
    }

    function reduced() {
        return reduceMotion.matches;
    }

    function pathEl() {
        return line.getElement();
    }

    function setDash(path, length, offset) {
        path.style.strokeDasharray = length + ' ' + length;
        path.style.strokeDashoffset = String(offset);
    }

    function stopDraw() {
        drawToken += 1;
    }

    function clearMarkerTimers() {
        markerTimers.forEach(function (id) { window.clearTimeout(id); });
        markerTimers = [];
    }

    function revealMarker(marker, on) {
        const icon = marker.getElement();
        const tip = marker.getTooltip() && marker.getTooltip().getElement();
        if (icon) icon.classList.toggle('is-in', on);
        if (tip) tip.classList.toggle('is-in', on);
    }

    function showMarkers(stagger) {
        clearMarkerTimers();
        placed.forEach(function (marker, i) {
            if (!stagger || reduced()) {
                revealMarker(marker, true);
                return;
            }
            revealMarker(marker, false);
            markerTimers.push(window.setTimeout(function () {
                revealMarker(marker, true);
            }, i * 180));
        });
    }

    function whenPath(fn) {
        let tries = 0;
        const token = drawToken;
        function tick() {
            if (token !== drawToken) return;
            const path = pathEl();
            if ((!path || path.getTotalLength() < 1) && tries < 40) {
                tries += 1;
                requestAnimationFrame(tick);
                return;
            }
            if (path && path.getTotalLength() >= 1) fn(path);
        }
        requestAnimationFrame(tick);
    }

    function hideLine() {
        stopDraw();
        line.setStyle({ opacity: 0 });
        whenPath(function (path) {
            setDash(path, path.getTotalLength(), path.getTotalLength());
        });
    }

    function showLine(animate) {
        stopDraw();
        line.setStyle({ opacity: 0.95 });
        whenPath(function (path) {
            drawPath(path, animate);
        });
    }

    function drawPath(path, animate) {
        const length = path.getTotalLength();
        if (!animate || reduced()) {
            stopDraw();
            setDash(path, length, 0);
            return;
        }
        const token = ++drawToken;
        const started = performance.now();
        setDash(path, length, length);
        function frame(now) {
            if (token !== drawToken) return;
            const t = Math.min(1, (now - started) / DRAW_MS);
            const eased = 1 - Math.pow(1 - t, 3);
            setDash(path, length, length * (1 - eased));
            if (t < 1) requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
    }

    function show(next, fromUser) {
        index = next;
        if (fromUser) held = true;
        window.clearTimeout(timer);
        stage.dataset.step = String(next + 1);
        stage.setAttribute('aria-labelledby', tabs[next].id);
        stage.classList.add('is-playing');
        stage.querySelector('.tour-limits').setAttribute('aria-hidden', next === 1 ? 'false' : 'true');
        stage.querySelector('.tour-result').setAttribute('aria-hidden', next === 2 ? 'false' : 'true');
        tabs.forEach(function (tab, i) {
            const on = i === next;
            tab.setAttribute('aria-selected', on ? 'true' : 'false');
            tab.tabIndex = on ? 0 : -1;
        });
        map.invalidateSize();
        if (next === 0) {
            hideLine();
            showMarkers(true);
        } else {
            showMarkers(false);
            if (next === 2) showLine(true);
            else hideLine();
        }
        if (!held && !reduced() && visible) {
            timer = window.setTimeout(function () {
                show((index + 1) % tabs.length, false);
            }, DWELL_MS);
        }
    }

    tabs.forEach(function (tab, i) {
        tab.addEventListener('click', function () {
            show(i, true);
        });
        tab.addEventListener('keydown', function (event) {
            let next = null;
            if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (i + 1) % tabs.length;
            if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
            if (event.key === 'Home') next = 0;
            if (event.key === 'End') next = tabs.length - 1;
            if (next === null) return;
            event.preventDefault();
            tabs[next].focus();
            show(next, true);
        });
    });

    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver(function (entries) {
            visible = entries[0].isIntersecting;
            if (!visible) {
                window.clearTimeout(timer);
                stopDraw();
                return;
            }
            fitMap();
            if (!held && !reduced()) show(index, false);
        }, { threshold: 0.35 });
        observer.observe(stage);
    } else {
        visible = true;
        show(0, false);
    }

    reduceMotion.addEventListener('change', function () {
        if (reduced()) held = true;
        show(index, reduced());
    });
})();
