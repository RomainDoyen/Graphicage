(function () {
    'use strict';

    function refreshIcons(root) {
        if (window.lucide) {
            window.lucide.createIcons({ attrs: { 'aria-hidden': 'true' }, nameAttr: 'data-lucide' });
        }
    }

    function initPasswordToggles(root) {
        root.querySelectorAll('.password-field').forEach((wrapper) => {
            const input = wrapper.querySelector('input');
            const toggle = wrapper.querySelector('.password-toggle');
            if (!input || !toggle || toggle.dataset.bound) return;
            toggle.dataset.bound = '1';

            toggle.addEventListener('click', () => {
                const visible = wrapper.classList.toggle('is-visible');
                input.type = visible ? 'text' : 'password';
                toggle.setAttribute('aria-pressed', visible ? 'true' : 'false');
                toggle.setAttribute(
                    'aria-label',
                    visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe',
                );
            });
        });
    }

    function initFormLoading(root) {
        root.querySelectorAll('.auth-form').forEach((form) => {
            if (form.dataset.bound) return;
            form.dataset.bound = '1';

            form.addEventListener('submit', () => {
                const btn = form.querySelector('button[type="submit"]');
                if (!btn || btn.classList.contains('is-loading')) return;

                btn.classList.add('is-loading');
                btn.disabled = true;
                const label = btn.querySelector('.btn-label');
                if (label) {
                    btn.dataset.originalLabel = label.textContent;
                    label.textContent = 'Envoi en cours…';
                }
            });
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        initPasswordToggles(document);
        initFormLoading(document);
        refreshIcons(document);
    });
}());
