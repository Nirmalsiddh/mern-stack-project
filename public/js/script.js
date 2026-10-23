(() => {
    'use strict';
    const forms = document.querySelectorAll('.needs-validation');
    for (const form of forms) {
        form.addEventListener('submit', event => {
            if (!form.checkValidity()) {
                event.preventDefault();
                event.stopPropagation();
                if (form.querySelectorAll) {
                    const fields = form.querySelectorAll('input, textarea, select');
                    for (const field of fields) {
                        if (field.willValidate) field.setAttribute('aria-invalid', String(!field.validity.valid));
                    }
                    // Fieldsets can match :invalid but cannot receive focus.
                    const firstInvalid = Array.from(fields).find(field => {
                        if (!field.willValidate || field.validity.valid ||
                            field.closest('[hidden], [inert]') || !field.getClientRects().length) return false;
                        const visibility = window.getComputedStyle(field).visibility;
                        return visibility !== 'hidden' && visibility !== 'collapse';
                    });
                    firstInvalid?.focus();
                }
            }
            form.classList.add('was-validated');
        }, false);
        if (form.querySelectorAll) {
            for (const field of form.querySelectorAll('input, textarea, select')) {
                field.addEventListener('input', () => {
                    if (field.hasAttribute('aria-invalid')) field.setAttribute('aria-invalid', String(!field.validity.valid));
                });
            }
        }
    }
    const taxSwitch = document.getElementById('flexSwitchCheckDefault');
    if (taxSwitch) {
        taxSwitch.addEventListener('change', () => {
            for (const info of document.getElementsByClassName('tax-info')) {
                info.style.display = taxSwitch.checked ? 'inline' : 'none';
            }
        });
    }
    // Keep image recovery and menu behavior in this external, CSP-safe script.
    if (!document.addEventListener) return;
    function fallbackImage(image) {
        if (image?.tagName !== 'IMG' || !image.dataset.fallback) return;
        const fallback = image.dataset.fallback;
        delete image.dataset.fallback; // A missing fallback must never cause a loop.
        image.removeAttribute('srcset');
        image.alt = 'Photo unavailable. ' + image.alt;
        image.src = fallback;
    }
    document.addEventListener('error', event => fallbackImage(event.target), true);
    for (const image of document.querySelectorAll('img[data-fallback]')) {
        if (image.complete && !image.naturalWidth) fallbackImage(image);
    }
    for (const link of document.querySelectorAll('[data-nav-link]')) {
        if (link.getAttribute('href') === window.location.pathname) link.setAttribute('aria-current', 'page');
    }
    for (const input of document.querySelectorAll('input[data-max-bytes]')) {
        input.addEventListener('change', () => {
            const tooLarge = input.files[0]?.size > Number(input.dataset.maxBytes);
            input.setCustomValidity(tooLarge ? 'Choose an image no larger than 5 MB.' : '');
            input.setAttribute('aria-invalid', String(tooLarge));
        });
    }
    if (!window.bootstrap) {
        for (const button of document.querySelectorAll('[data-bs-dismiss="alert"]')) {
            button.addEventListener('click', () => button.closest('.feedback')?.remove());
        }
    }
    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        const menu = document.querySelector('.mobile-navigation[open]');
        if (menu) { menu.open = false; menu.querySelector('summary').focus(); }
    });
})();
