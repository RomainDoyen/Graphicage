/**
 * Graphicage TER — authentification et historique
 */
(function (global) {
    'use strict';

    let currentUser = null;
    let historyCache = [];
    let bridge = null;

    async function fetchMe() {
        const response = await fetch('/api/auth/me/', { credentials: 'same-origin' });
        const data = await response.json();
        currentUser = data.authenticated ? data.user : null;
        return currentUser;
    }

    function formatDate(iso) {
        try {
            return new Date(iso).toLocaleString('fr-FR', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
            });
        } catch (_) {
            return iso;
        }
    }

    function renderAuthPanel() {
        const user = document.getElementById('auth-user');
        const usernameEl = document.getElementById('auth-username');
        if (!user) return;

        if (currentUser && usernameEl) {
            usernameEl.textContent = currentUser.username;
        }
        const initials = document.getElementById('account-initials');
        const toggle = document.getElementById('account-toggle');
        if (currentUser && initials) {
            initials.textContent = currentUser.username.slice(0, 2).toUpperCase();
        }
        if (currentUser && toggle) {
            toggle.setAttribute('aria-label', `Mon compte, ${currentUser.username}`);
        }
        global.dispatchEvent(new CustomEvent('graphicage:auth-changed', { detail: { user: currentUser } }));
    }

    async function loadHistory() {
        if (!currentUser) {
            historyCache = [];
            renderHistoryList();
            return [];
        }
        try {
            const response = await fetch('/api/history/', { credentials: 'same-origin' });
            if (!response.ok) throw new Error('Impossible de charger l\'historique.');
            const data = await response.json();
            historyCache = data.history || [];
            renderHistoryList();
            return historyCache;
        } catch (err) {
            bridge?.showToast?.(err.message, 'error');
            return [];
        }
    }

    function renderHistoryList() {
        const listEl = document.getElementById('history-list');
        const emptyEl = document.getElementById('history-empty');
        if (!listEl) return;

        if (!currentUser || !historyCache.length) {
            listEl.innerHTML = '';
            if (emptyEl) {
                emptyEl.hidden = Boolean(currentUser && historyCache.length);
                emptyEl.textContent = currentUser
                    ? 'Aucun itinéraire calculé pour le moment.'
                    : 'Connectez-vous pour voir vos tournées passées.';
            }
            return;
        }

        if (emptyEl) emptyEl.hidden = true;
        listEl.innerHTML = historyCache.map((entry) => {
            const summary = entry.summary || {};
            const meta = [
                summary.total_distance_label,
                summary.total_duration_label,
                `${entry.point_count} pt(s)`,
            ].filter(Boolean).join(' · ');
            return `
                <li class="history-item" data-id="${entry.id}">
                    <div class="history-item-body">
                        <strong class="history-item-title">${escapeHtml(entry.title)}</strong>
                        <span class="history-item-meta">${escapeHtml(meta)}</span>
                        <time class="history-item-date">${escapeHtml(formatDate(entry.created_at))}</time>
                    </div>
                    <div class="history-item-actions">
                        <button type="button" class="btn btn-ghost btn-sm btn-history-restore" data-id="${entry.id}" title="Recharger">
                            <i data-lucide="rotate-ccw" class="icon icon-sm"></i>
                        </button>
                        <button type="button" class="btn btn-ghost btn-sm btn-history-delete" data-id="${entry.id}" title="Supprimer">
                            <i data-lucide="trash-2" class="icon icon-sm"></i>
                        </button>
                    </div>
                </li>`;
        }).join('');

        bridge?.refreshIcons?.(listEl);
        bindHistoryEvents(listEl);
    }

    function bindHistoryEvents(listEl) {
        listEl.querySelectorAll('.btn-history-restore').forEach((btn) => {
            btn.addEventListener('click', () => restoreHistory(Number(btn.dataset.id)));
        });
        listEl.querySelectorAll('.btn-history-delete').forEach((btn) => {
            btn.addEventListener('click', () => deleteHistory(Number(btn.dataset.id)));
        });
    }

    async function restoreHistory(id) {
        try {
            const response = await fetch(`/api/history/${id}/restore/`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'X-CSRFToken': bridge.getCsrfToken(),
                },
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.detail || 'Erreur serveur.');

            bridge.applyState({
                config: data.config,
                points: data.points,
            });
            if (data.result) {
                bridge.displayResults(data.result);
                bridge.drawRoutes(data.result.routes);
                bridge.setLastResult(data.result);
            }
            bridge.showToast('Tournée rechargée depuis l\'historique.', 'success');
            bridge.expandPanel('results');
        } catch (err) {
            bridge.showToast(err.message, 'error');
        }
    }

    async function deleteHistory(id) {
        if (!confirm('Supprimer cette entrée de l\'historique ?')) return;
        try {
            const response = await fetch(`/api/history/${id}/`, {
                method: 'DELETE',
                credentials: 'same-origin',
                headers: {
                    'X-CSRFToken': bridge.getCsrfToken(),
                },
            });
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.detail || 'Erreur serveur.');
            }
            historyCache = historyCache.filter((e) => e.id !== id);
            renderHistoryList();
            bridge.showToast('Entrée supprimée.', 'info');
        } catch (err) {
            bridge.showToast(err.message, 'error');
        }
    }

    async function logout() {
        try {
            await fetch('/api/auth/logout/', {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'X-CSRFToken': bridge.getCsrfToken(),
                },
            });
        } catch (_) {
            /* session peut déjà être expirée */
        }
        currentUser = null;
        renderAuthPanel();
        renderHistoryList();
        bridge.showToast('Déconnexion effectuée.', 'info');
        global.location.href = '/';
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = String(str ?? '');
        return div.innerHTML;
    }

    function bindAccountMenu() {
        const toggle = document.getElementById('account-toggle');
        const popover = document.getElementById('account-popover');
        if (!toggle || !popover) return;

        function closeMenu() {
            popover.hidden = true;
            toggle.setAttribute('aria-expanded', 'false');
        }

        toggle.addEventListener('click', (event) => {
            event.stopPropagation();
            const willOpen = popover.hidden;
            popover.hidden = !willOpen;
            toggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
        });

        document.addEventListener('click', (event) => {
            if (popover.hidden || event.target.closest('.account-menu')) return;
            closeMenu();
        });

        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape' || popover.hidden) return;
            closeMenu();
            toggle.focus();
        });
    }

    function bindAuthEvents() {
        document.getElementById('btn-logout')?.addEventListener('click', logout);
        document.getElementById('tab-btn-history')?.addEventListener('click', loadHistory);
        bindAccountMenu();
    }

    global.GraphicageAuth = {
        init(api) {
            bridge = api;
            bindAuthEvents();
        },
        async refresh() {
            await fetchMe();
            renderAuthPanel();
            await loadHistory();
        },
        onRouteSaved() {
            if (currentUser) loadHistory();
        },
        isAuthenticated: () => Boolean(currentUser),
        getUser: () => currentUser,
    };
}(window));
