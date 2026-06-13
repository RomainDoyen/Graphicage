/**
 * Documentation Graphicage TER — navigation et interactions
 */
(function () {
    'use strict';

    const NAV_ITEMS = [
        { section: 'Introduction' },
        { href: 'index.html', label: 'Vue d\'ensemble' },
        { href: 'installation.html', label: 'Installation' },
        { href: 'usage.html', label: 'Guide utilisateur' },
        { href: 'comptes.html', label: 'Comptes & historique' },
        { section: 'Technique' },
        { href: 'architecture.html', label: 'Architecture' },
        { href: 'api.html', label: 'API REST' },
        { href: 'ortools.html', label: 'OR-Tools & algorithmes' },
        { section: 'Projet' },
        { href: 'migration.html', label: 'Migration depuis GraphicageTER' },
    ];

    function getCurrentPage() {
        const path = window.location.pathname;
        const filename = path.split('/').pop() || 'index.html';
        return filename === '' ? 'index.html' : filename;
    }

    function buildSidebar() {
        const sidebar = document.querySelector('.doc-sidebar');
        if (!sidebar) return;

        const current = getCurrentPage();
        let navHtml = `
            <div class="doc-sidebar-header">
                <h1>Graphicage TER</h1>
                <p>Documentation v2.0</p>
            </div>
            <nav class="doc-nav"><ul>
        `;

        NAV_ITEMS.forEach(item => {
            if (item.section) {
                navHtml += `<li class="nav-section">${item.section}</li>`;
            } else {
                const active = item.href === current ? ' active' : '';
                navHtml += `<li><a href="${item.href}" class="${active.trim()}">${item.label}</a></li>`;
            }
        });

        navHtml += '</ul></nav>';
        navHtml += `<p class="doc-sidebar-footer"><a href="/">← Retour au site</a></p>`;
        sidebar.innerHTML = navHtml;
    }

    function initMobileMenu() {
        const toggle = document.querySelector('.doc-menu-toggle');
        const sidebar = document.querySelector('.doc-sidebar');
        if (!toggle || !sidebar) return;

        toggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
        });

        sidebar.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => sidebar.classList.remove('open'));
        });
    }

    function initCodeCopy() {
        document.querySelectorAll('pre').forEach(block => {
            block.setAttribute('tabindex', '0');
        });
    }

    function initSearch() {
        const input = document.getElementById('doc-search');
        if (!input) return;

        input.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            document.querySelectorAll('.doc-main section').forEach(section => {
                const text = section.textContent.toLowerCase();
                section.style.display = !query || text.includes(query) ? '' : 'none';
            });
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        buildSidebar();
        initMobileMenu();
        initCodeCopy();
        initSearch();
    });
})();
