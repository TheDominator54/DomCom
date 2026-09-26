// Newsletter signup for index.html and newsletter.html.
// Posts straight to the MailerLite form endpoint, so signups don't depend on MailerLite's
// embed scripts loading first (when they hadn't, the browser opened the raw endpoint in a new tab).
(function () {
    var SUCCESS_URL = 'newsletter-success.html';
    // MailerLite's hosted copy of the same form. Content blockers that stop requests to
    // MailerLite from other sites still let people open this page directly.
    var HOSTED_FORM_URL = 'https://preview.mailerlite.io/forms/2024480/175995152767124497/share';
    var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    document.querySelectorAll('.signup-form').forEach(function (form) {
        var input = form.querySelector('input[type="email"]');
        var button = form.querySelector('button[type="submit"]');
        var note = form.querySelector('.signup-note');
        var defaultNote = note.textContent;
        var buttonLabel = button.textContent;

        function setNote(message, isError, link) {
            note.textContent = message;
            if (link) {
                var a = document.createElement('a');
                a.href = link.href;
                a.textContent = link.text;
                a.target = '_blank';
                a.rel = 'noopener';
                note.appendChild(document.createTextNode(' '));
                note.appendChild(a);
            }
            form.classList.toggle('has-error', Boolean(isError));
            input.setAttribute('aria-invalid', isError ? 'true' : 'false');
        }

        function setBusy(busy) {
            button.disabled = busy;
            button.textContent = busy ? 'Subscribing…' : buttonLabel;
        }

        function showUnreachable(detail) {
            console.warn('Newsletter signup: request to MailerLite failed.', detail);
            setNote("Your browser couldn't reach MailerLite, the service that sends the newsletter. This is usually a content blocker.", true, {
                href: HOSTED_FORM_URL,
                text: 'Sign up on MailerLite instead →'
            });
            setBusy(false);
        }

        form.addEventListener('submit', function (event) {
            event.preventDefault();

            var email = input.value.trim();
            if (!EMAIL_PATTERN.test(email)) {
                setNote('Please enter a valid email address.', true);
                input.focus();
                return;
            }

            var body = new URLSearchParams();
            new FormData(form).forEach(function (value, key) { body.append(key, value); });
            body.set('fields[email]', email);
            body.set('ajax', '1');

            setNote(defaultNote, false);
            setBusy(true);

            fetch(form.action, {
                method: 'POST',
                body: body,
                headers: { Accept: 'application/json' }
            })
                .then(function (response) {
                    return response.text().then(function (text) {
                        try {
                            return JSON.parse(text);
                        } catch (e) {
                            throw { status: response.status, body: text.slice(0, 300) };
                        }
                    });
                })
                .then(function (result) {
                    if (result && result.success) {
                        window.location.href = SUCCESS_URL;
                        return;
                    }
                    var fieldErrors = result && result.errors && result.errors.fields;
                    if (fieldErrors && fieldErrors.email) {
                        setNote(fieldErrors.email[0], true);
                    } else {
                        console.warn('Newsletter signup: unexpected response from MailerLite.', result);
                        setNote('Something went wrong. Please try again.', true);
                    }
                    setBusy(false);
                })
                .catch(showUnreachable);
        });

        input.addEventListener('input', function () {
            if (form.classList.contains('has-error')) setNote(defaultNote, false);
        });
    });
})();
