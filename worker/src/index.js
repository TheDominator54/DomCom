// Cloudflare Worker behind domrand.com/api/subscribe.
// Adds newsletter signups to MailerLite from domrand.com's own domain, so content blockers
// that stop cross-site requests to MailerLite don't break the signup form.
//
// With a MAILERLITE_API_TOKEN secret set, it uses MailerLite's official API. MailerLite's
// public form endpoint rejects many requests that arrive from a server (403), so the form
// relay below is only a stopgap for when no token is configured.

const API_SUBSCRIBERS_URL = 'https://connect.mailerlite.com/api/subscribers';
const API_GROUPS_URL = 'https://connect.mailerlite.com/api/groups';
const MAILERLITE_FORM_URL = 'https://assets.mailerlite.com/jsonp/2024480/forms/175995152767124497/subscribe';
const ALLOWED_ORIGINS = ['https://domrand.com', 'https://www.domrand.com'];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;

// Group ID resolved from MAILERLITE_GROUP (an ID or a group name), cached per Worker instance
let cachedGroupId = null;

function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
}

function emailError(message) {
    return json({ success: false, errors: { fields: { email: [message] } } });
}

async function resolveGroupId(env) {
    const group = (env.MAILERLITE_GROUP || '').trim();
    if (!group) return null;
    if (/^\d+$/.test(group)) return group;
    if (cachedGroupId) return cachedGroupId;

    const url = `${API_GROUPS_URL}?filter[name]=${encodeURIComponent(group)}&limit=100`;
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${env.MAILERLITE_API_TOKEN}`, Accept: 'application/json' }
    });
    if (!res.ok) throw new Error(`Group lookup failed with ${res.status}`);
    const { data } = await res.json();
    const match = (data || []).find((g) => g.name.toLowerCase() === group.toLowerCase());
    if (!match) throw new Error(`No MailerLite group named "${group}"`);
    cachedGroupId = match.id;
    return cachedGroupId;
}

async function subscribeViaApi(email, request, env) {
    // Resolve the group first, so even a request with no email checks the token and group
    let groupId;
    try {
        groupId = await resolveGroupId(env);
    } catch (err) {
        console.log(JSON.stringify({ via: 'api', groupError: String(err.message || err) }));
        return json({ success: false, error: 'MailerLite group not found' }, 502);
    }

    if (!email) return emailError('The email field is required.');
    if (!EMAIL_PATTERN.test(email)) return emailError('Please enter a valid email address.');

    // No status: with "Double opt-in for API and integrations" on, new people get the
    // confirmation email, and existing subscribers keep their current status
    const payload = { email, groups: [groupId] };
    const ip = request.headers.get('CF-Connecting-IP');
    if (ip) payload.ip_address = ip;

    let res;
    try {
        res = await fetch(API_SUBSCRIBERS_URL, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${env.MAILERLITE_API_TOKEN}`,
                'Content-Type': 'application/json',
                Accept: 'application/json'
            },
            body: JSON.stringify(payload)
        });
    } catch (err) {
        return json({ success: false, error: 'MailerLite unreachable' }, 502);
    }

    // The API echoes the subscriber back, so log the status only (never the email)
    console.log(JSON.stringify({ via: 'api', status: res.status }));
    if (res.ok) return json({ success: true });

    let data = {};
    try {
        data = await res.json();
    } catch (err) {}
    if (res.status === 422 && data.errors && data.errors.email) {
        return json({ success: false, errors: { fields: { email: data.errors.email } } });
    }
    console.log(JSON.stringify({ via: 'api', status: res.status, message: data.message }));
    return json({ success: false, error: 'MailerLite API error' }, 502);
}

async function subscribeViaForm(email, request) {
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
            headers: {
                Accept: 'application/json',
                // Pass along what a browser would send; the endpoint is built for browsers
                Origin: request.headers.get('Origin') || 'https://domrand.com',
                Referer: request.headers.get('Referer') || 'https://domrand.com/',
                'User-Agent': request.headers.get('User-Agent') || 'domrand.com signup',
                'Accept-Language': request.headers.get('Accept-Language') || 'en'
            }
        });
    } catch (err) {
        return json({ success: false, error: 'MailerLite unreachable' }, 502);
    }

    const text = await upstream.text();
    // MailerLite's form reply doesn't include the email address
    console.log(JSON.stringify({ via: 'form', upstreamStatus: upstream.status, reply: text.slice(0, 200) }));
    try {
        return json(JSON.parse(text), upstream.status);
    } catch (err) {
        return json({ success: false, error: 'Unexpected response from MailerLite', status: upstream.status }, 502);
    }
}

export default {
    async fetch(request, env) {
        if (request.method !== 'POST') {
            return json({ success: false, error: 'Method not allowed' }, 405);
        }

        // Browsers always send Origin on POST; reject other sites posting through us
        const origin = request.headers.get('Origin');
        if (origin && !ALLOWED_ORIGINS.includes(origin)) {
            console.log(JSON.stringify({ rejectedOrigin: origin }));
            return json({ success: false, error: 'Forbidden' }, 403);
        }

        let email = '';
        try {
            const form = await request.formData();
            email = String(form.get('fields[email]') || '').trim().slice(0, MAX_EMAIL_LENGTH);
        } catch (err) {
            return json({ success: false, error: 'Bad request' }, 400);
        }

        // Only use the API once both the token and the form's group are configured,
        // so signups never land outside the group the form uses
        return env.MAILERLITE_API_TOKEN && env.MAILERLITE_GROUP
            ? subscribeViaApi(email, request, env)
            : subscribeViaForm(email, request);
    }
};
