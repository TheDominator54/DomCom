// Newsletter signup for index.html and newsletter.html.
// On domrand.com, signups go through /api/subscribe (the Cloudflare Worker in worker/),
// which relays them to MailerLite from our own domain so content blockers don't interfere.
// If the relay fails, the form posts to MailerLite directly, and as a last resort links
// to MailerLite's hosted copy of the form.
(function () {
    var RELAY_URL = '/api/subscribe';
    var SUCCESS_URL = 'newsletter-success.html';
    var HOSTED_FORM_URL = 'https://preview.mailerlite.io/forms/2024480/175995152767124497/share';
    var EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    // The relay only exists on the live site, not on a local preview
    var relayAvailable = /(^|\.)domrand\.com$/.test(window.location.hostname);

    // POST and parse the JSON reply; anything that isn't JSON counts as a failure
    function postJson(url, body) {
        return fetch(url, {
            method: 'POST',
            body: body,
            headers: { Accept: 'application/json' }
        }).then(function (response) {
            return response.text().then(function (text) {
                try {
                    return JSON.parse(text);
                } catch (e) {
                    throw { url: url, status: response.status, body: text.slice(0, 300) };
                }
            });
        });
    }

    // A real answer from MailerLite: either success or a problem with the email itself
    function isMailerLiteAnswer(result) {
        return Boolean(result && (result.success || (result.errors && result.errors.fields)));
    }

    document.querySelectorAll('.signup-form').forEach(function (form) {
        var input = form.querySelector('input[type="email"]');
        var button = form.querySelector('button[type="submit"]');
        var note = form.querySelector('.signup-note');
        var defaultNote = note.textContent;
        var buttonLabel = button.textContent;

        function setNote(message, isError, withHostedLink) {
            note.textContent = message;
            if (withHostedLink) {
                var a = document.createElement('a');
                a.href = HOSTED_FORM_URL;
                a.textContent = 'sign up on MailerLite instead →';
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

        function showResult(result) {
            if (result.success) {
                window.location.href = SUCCESS_URL;
                return;
            }
            setNote(result.errors.fields.email ? result.errors.fields.email[0] : 'Please check your email address.', true);
            setBusy(false);
        }

        function showFailure(detail) {
            console.warn('Newsletter signup failed.', detail);
            setNote("Couldn't reach the newsletter service. Please try again in a moment, or", true, true);
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

            var viaRelay = relayAvailable
                ? postJson(RELAY_URL, body).then(function (result) {
                    if (isMailerLiteAnswer(result)) return result;
                    throw { url: RELAY_URL, result: result };
                })
                : Promise.reject({ skipped: true });

            viaRelay
                .catch(function (relayError) {
                    if (!relayError.skipped) console.warn('Newsletter signup: relay failed, trying MailerLite directly.', relayError);
                    return postJson(form.action, body).then(function (result) {
                        if (isMailerLiteAnswer(result)) return result;
                        throw { url: form.action, result: result };
                    });
                })
                .then(showResult)
                .catch(showFailure);
        });

        input.addEventListener('input', function () {
            if (form.classList.contains('has-error')) setNote(defaultNote, false);
        });
    });
})();
