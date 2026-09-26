// Newsletter signup for index.html and newsletter.html.
// Posts straight to the MailerLite form endpoint, so signups don't depend on MailerLite's
// embed scripts loading first (when they hadn't, the browser opened the raw endpoint in a new tab).
(function () {
    var SUCCESS_URL = 'newsletter-success.html';
    var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    document.querySelectorAll('.signup-form').forEach(function (form) {
        var input = form.querySelector('input[type="email"]');
        var button = form.querySelector('button[type="submit"]');
        var note = form.querySelector('.signup-note');
        var defaultNote = note.textContent;
        var buttonLabel = button.textContent;

        function setNote(message, isError) {
            note.textContent = message;
            form.classList.toggle('has-error', Boolean(isError));
            input.setAttribute('aria-invalid', isError ? 'true' : 'false');
        }

        function setBusy(busy) {
            button.disabled = busy;
            button.textContent = busy ? 'Subscribing…' : buttonLabel;
        }

        form.addEventListener('submit', function (event) {
            event.preventDefault();

            var email = input.value.trim();
            if (!EMAIL_PATTERN.test(email)) {
                setNote('Please enter a valid email address.', true);
                input.focus();
                return;
            }

            var body = new URLSearchParams(new FormData(form));
            body.set('fields[email]', email);
            body.set('ajax', '1');

            setNote(defaultNote, false);
            setBusy(true);

            fetch(form.action, {
                method: 'POST',
                body: body,
                headers: { Accept: 'application/json' }
            })
                .then(function (response) { return response.json(); })
                .then(function (result) {
                    if (result && result.success) {
                        window.location.href = SUCCESS_URL;
                        return;
                    }
                    var fieldErrors = result && result.errors && result.errors.fields;
                    var message = fieldErrors && fieldErrors.email ? fieldErrors.email[0] : 'Something went wrong. Please try again.';
                    setNote(message, true);
                    setBusy(false);
                })
                .catch(function () {
                    setNote("Couldn't reach the signup service. Please try again, or email contact@domrand.com.", true);
                    setBusy(false);
                });
        });

        input.addEventListener('input', function () {
            if (form.classList.contains('has-error')) setNote(defaultNote, false);
        });
    });
})();
