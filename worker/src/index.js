// Cloudflare Worker behind domrand.com/api/subscribe.
// Relays newsletter signups to MailerLite from domrand.com's own domain, so content
// blockers that stop cross-site requests to MailerLite don't break the signup form.
// It only ever talks to this one MailerLite form, so it can't be used as a general proxy.

const MAILERLITE_FORM_URL = 'https://assets.mailerlite.com/jsonp/2024480/forms/175995152767124497/subscribe';
const ALLOWED_ORIGINS = ['https://domrand.com', 'https://www.domrand.com'];
const MAX_EMAIL_LENGTH = 254;

function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
}

export default {
    async fetch(request) {
        if (request.method !== 'POST') {
            return json({ success: false, error: 'Method not allowed' }, 405);
        }

        // Browsers always send Origin on POST; reject other sites posting through us
        const origin = request.headers.get('Origin');
        if (origin && !ALLOWED_ORIGINS.includes(origin)) {
            return json({ success: false, error: 'Forbidden' }, 403);
        }

        let email = '';
        try {
            const form = await request.formData();
            email = String(form.get('fields[email]') || '').trim().slice(0, MAX_EMAIL_LENGTH);
        } catch (err) {
            return json({ success: false, error: 'Bad request' }, 400);
        }

        // MailerLite does the real validation and returns field errors we pass straight back
        const body = new URLSearchParams({
            'fields[email]': email,
            'ml-submit': '1',
            anticsrf: 'true',
            ajax: '1'
        });

        let upstream;
        try {
            upstream = await fetch(MAILERLITE_FORM_URL, {
                method: 'POST',
                body,
                headers: { Accept: 'application/json' }
            });
        } catch (err) {
            return json({ success: false, error: 'MailerLite unreachable' }, 502);
        }

        const text = await upstream.text();
        try {
            return json(JSON.parse(text), upstream.status);
        } catch (err) {
            return json({ success: false, error: 'Unexpected response from MailerLite', status: upstream.status }, 502);
        }
    }
};
