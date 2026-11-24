const enc = new TextEncoder();
const json = (data, status=200, extra={}) => new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extra}});
function base64url(bytes){return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function unbase64url(s){return Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));}
async function hmac(secret,data){const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return base64url(new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(data))));}
function equal(a,b){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
async function token(env,role,guest={}){const payload=base64url(enc.encode(JSON.stringify({role,...guest,exp:Date.now()+8*3600_000})));return payload+'.'+await hmac(env.TOKEN_SECRET,payload);}
async function verify(req,env,role){const auth=req.headers.get('Authorization')||'';const m=/^Bearer ([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(auth);if(!m)return false;const sig=await hmac(env.TOKEN_SECRET,m[1]);if(!equal(sig,m[2]))return false;try{const p=JSON.parse(new TextDecoder().decode(unbase64url(m[1])));return p.role===role&&p.exp>Date.now()?p:null;}catch{return null;}}
function berlinDate(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function status(event){const today=berlinDate();if(!event.active||today>=event.rest_from)return'rest';if(today>event.deadline)return'closed';return'open';}
async function body(req){const t=await req.text();if(t.length>4000)throw new Error('Eingabe zu lang.');return JSON.parse(t||'{}');}
async function throttle(req,env,kind){const ip=req.headers.get('CF-Connecting-IP')||'unknown';const key=kind+':'+await hmac(env.TOKEN_SECRET,ip);const now=Date.now();const row=await env.DB.prepare('SELECT count,reset_at FROM login_attempts WHERE key=?').bind(key).first();if(row&&row.reset_at>now&&row.count>=10)return false;await env.DB.prepare('INSERT INTO login_attempts(key,count,reset_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset_at<? THEN 1 ELSE count+1 END, reset_at=CASE WHEN reset_at<? THEN ? ELSE reset_at END').bind(key,1,now+900000,now,now,now+900000).run();return true;}

const legacyEventId = 1;

function eventState(event) {
  return event ? status(event) : 'rest';
}

function publicEvent(event) {
  if (!event) return null;
  const {id, title, date, time, place, activity, deadline, rest_from, active} = event;
  return {id, title, date, time, place, activity, deadline, restFrom: rest_from, active: !!active};
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T12:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function eventError(input) {
  for (const key of ['title', 'date', 'time', 'place', 'activity', 'deadline', 'restFrom']) {
    if (typeof input[key] !== 'string' || !input[key].trim() || input[key].length > 160) {
      return 'Bitte alle Felder ausfüllen.';
    }
  }
  if (![input.date, input.deadline, input.restFrom].every(validDate)
      || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input.time)
      || input.deadline >= input.restFrom) return 'Datumsangaben prüfen.';
  return null;
}

function eventValues(input) {
  return [input.title.trim(), input.date, input.time, input.place.trim(), input.activity.trim(),
    input.deadline, input.restFrom, input.active === true ? 1 : 0];
}

function findEvent(db, id) {
  return (id === legacyEventId
    ? db.prepare('SELECT * FROM events WHERE id=1')
    : db.prepare('SELECT * FROM future_events WHERE id=?').bind(id)).first();
}

async function findGuest(db, guest) {
  const eventId = guest.eventId ?? legacyEventId;
  if (!Number.isSafeInteger(eventId) || eventId < 1) return null;
  const person = await (eventId === legacyEventId
    ? db.prepare('SELECT invite_token_hash FROM invitees WHERE name=?').bind(guest.name)
    : db.prepare('SELECT invite_token_hash FROM future_invitees WHERE event_id=? AND name=?').bind(eventId, guest.name)).first();
  if (!person || (guest.inviteHash && guest.inviteHash !== person.invite_token_hash)) return null;
  return findEvent(db, eventId);
}

function invitedNames(db, id) {
  return (id === legacyEventId
    ? db.prepare('SELECT name FROM invitees ORDER BY name')
    : db.prepare('SELECT name FROM future_invitees WHERE event_id=? ORDER BY name').bind(id)).all();
}

function responses(db, id) {
  return (id === legacyEventId
    ? db.prepare('SELECT name,answer,message,updated_at FROM rsvps ORDER BY name')
    : db.prepare('SELECT name,answer,message,updated_at FROM future_rsvps WHERE event_id=? ORDER BY name').bind(id)).all();
}

function eventList(db) {
  return db.prepare(`
    SELECT * FROM events
    UNION ALL
    SELECT * FROM future_events
    ORDER BY date ASC, time ASC, id ASC
  `).all();
}

function validName(name) {
  return typeof name === 'string' && !!name.trim() && name.trim().length <= 100;
}

export default {async fetch(req, env) {
  const origin = req.headers.get('Origin');
  const allowed = origin === env.ALLOWED_ORIGIN;
  const cors = allowed ? {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Vary': 'Origin'
  } : {};
  const reply = (data, code) => json(data, code, cors);
  const fail = (error, code) => reply({error}, code);
  if (req.method === 'OPTIONS') return new Response(null, {status: allowed ? 204 : 403, headers: cors});
  if (origin && !allowed) return fail('Zugriff nicht erlaubt.', 403);
  if (!env.DB || !env.ADMIN_PASSWORD || !env.TOKEN_SECRET || !env.ALLOWED_ORIGIN) {
    return fail('Server noch nicht eingerichtet.', 503);
  }

  const db = env.DB;
  const url = new URL(req.url);
  const path = url.pathname;
  try {
    if (path === '/status' && req.method === 'GET') {
      const today = berlinDate();
      const available = await db.prepare(`
        SELECT deadline FROM events WHERE active=1 AND rest_from>?
        UNION ALL
        SELECT deadline FROM future_events WHERE active=1 AND rest_from>?
        ORDER BY deadline DESC LIMIT 1
      `).bind(today, today).first();
      return reply({status: available ? (available.deadline >= today ? 'open' : 'closed') : 'rest'});
    }

    if (path === '/guest/login' && req.method === 'POST') {
      if (!await throttle(req, env, 'guest')) return fail('Zu viele Versuche. Bitte später erneut versuchen.', 429);
      const input = await body(req);
      if (typeof input.invite !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.invite)) {
        return fail('Einladungslink ungültig.', 401);
      }
      const inviteHash = await hmac(env.TOKEN_SECRET, input.invite);
      const person = await db.prepare(`
        SELECT 1 AS event_id, name FROM invitees WHERE invite_token_hash=?
        UNION ALL
        SELECT event_id, name FROM future_invitees WHERE invite_token_hash=?
        LIMIT 1
      `).bind(inviteHash, inviteHash).first();
      if (!person) return fail('Einladungslink ungültig.', 401);
      if (eventState(await findEvent(db, person.event_id)) === 'rest') {
        return fail('Diese Veranstaltung ist derzeit nicht verfügbar.', 403);
      }
      return reply({token: await token(env, 'guest', {name: person.name, eventId: person.event_id, inviteHash})});
    }

    if ((path === '/guest/event' && req.method === 'GET') || (path === '/rsvp' && req.method === 'POST')) {
      const guest = await verify(req, env, 'guest');
      if (!guest) return fail('Persönlichen Einladungslink öffnen.', 401);
      const event = await findGuest(db, guest);
      if (!event) return fail('Einladung nicht mehr gültig.', 403);
      const state = eventState(event);

      if (path === '/guest/event') {
        if (state === 'rest') return fail('Diese Veranstaltung ist derzeit nicht verfügbar.', 403);
        const {title, date, time, place, activity, deadline} = event;
        return reply({event: {title, date, time, place, activity, deadline}, name: guest.name, status: state});
      }

      if (state !== 'open') return fail('Die Anmeldung ist geschlossen.', 403);
      const input = await body(req);
      if (!['yes', 'no'].includes(input.answer) || typeof input.message !== 'string' || input.message.length > 1000) {
        return fail('Bitte Eingaben prüfen.', 400);
      }
      const values = [guest.name, input.answer, input.message.trim(), new Date().toISOString()];
      await (event.id === legacyEventId
        ? db.prepare(`
            INSERT INTO rsvps(name,answer,message,updated_at) VALUES(?,?,?,?)
            ON CONFLICT(name) DO UPDATE SET answer=excluded.answer,message=excluded.message,updated_at=excluded.updated_at
          `).bind(...values)
        : db.prepare(`
            INSERT INTO future_rsvps(event_id,name,answer,message,updated_at) VALUES(?,?,?,?,?)
            ON CONFLICT(event_id,name) DO UPDATE SET answer=excluded.answer,message=excluded.message,updated_at=excluded.updated_at
          `).bind(event.id, ...values)).run();
      return reply({ok: true});
    }

    if (path === '/admin/login' && req.method === 'POST') {
      if (!await throttle(req, env, 'admin')) return fail('Zu viele Versuche. Bitte später erneut versuchen.', 429);
      const input = await body(req);
      if (typeof input.password !== 'string'
          || !equal(await hmac(env.TOKEN_SECRET, input.password), await hmac(env.TOKEN_SECRET, env.ADMIN_PASSWORD))) {
        return fail('Passwort ungültig.', 401);
      }
      return reply({token: await token(env, 'admin')});
    }

    if (!path.startsWith('/admin/')) return fail('Nicht gefunden.', 404);
    if (!await verify(req, env, 'admin')) return fail('Nicht angemeldet.', 401);

    if (path === '/admin/events' && req.method === 'GET') {
      return reply({events: (await eventList(db)).results.map(publicEvent)});
    }

    if (path === '/admin/events' && req.method === 'POST') {
      const input = await body(req);
      const error = eventError(input);
      if (error) return fail(error, 400);
      if (input.date < berlinDate()) return fail('Das Veranstaltungsdatum muss heute oder in der Zukunft liegen.', 400);
      const event = await db.prepare(`
        INSERT INTO future_events(id,title,date,time,place,activity,deadline,rest_from,active)
        VALUES((SELECT COALESCE(MAX(id),1)+1 FROM future_events),?,?,?,?,?,?,?,?)
        RETURNING id
      `).bind(...eventValues(input)).first();
      return reply({id: event.id}, 201);
    }

    const id = Number(url.searchParams.get('event') ?? legacyEventId);
    if (!Number.isSafeInteger(id) || id < 1) return fail('Veranstaltung ungültig.', 400);

    if (path === '/admin/data' && req.method === 'GET') {
      const event = await findEvent(db, id);
      if (!event && id !== legacyEventId) return fail('Veranstaltung nicht gefunden.', 404);
      const [rsvps, invitees] = await Promise.all([responses(db, id), invitedNames(db, id)]);
      const emptyEvent = {title:'',date:'',time:'',place:'',activity:'',deadline:'',restFrom:'',active:false};
      return reply({event: publicEvent(event) || emptyEvent, rsvps: rsvps.results, invitees: invitees.results.map(x => x.name), canDeleteInvitees: true});
    }

    if (path === '/admin/event' && req.method === 'PUT') {
      const input = await body(req);
      const error = eventError(input);
      if (error) return fail(error, 400);
      const values = eventValues(input);
      const result = await (id === legacyEventId
        ? db.prepare(`
            INSERT INTO events(id,title,date,time,place,activity,deadline,rest_from,active) VALUES(1,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET title=excluded.title,date=excluded.date,time=excluded.time,place=excluded.place,
              activity=excluded.activity,deadline=excluded.deadline,rest_from=excluded.rest_from,active=excluded.active
          `).bind(...values)
        : db.prepare(`
            UPDATE future_events SET title=?,date=?,time=?,place=?,activity=?,deadline=?,rest_from=?,active=? WHERE id=?
          `).bind(...values, id)).run();
      return result.meta.changes ? reply({ok: true}) : fail('Veranstaltung nicht gefunden.', 404);
    }

    if (!await findEvent(db, id) && id !== legacyEventId) return fail('Veranstaltung nicht gefunden.', 404);

    if (path === '/admin/link' && req.method === 'POST') {
      const input = await body(req);
      if (!validName(input.name)) return fail('Name prüfen.', 400);
      const invite = base64url(crypto.getRandomValues(new Uint8Array(32)));
      const hashed = await hmac(env.TOKEN_SECRET, invite);
      const result = await (id === legacyEventId
        ? db.prepare('UPDATE invitees SET invite_token_hash=? WHERE name=?').bind(hashed, input.name)
        : db.prepare('UPDATE future_invitees SET invite_token_hash=? WHERE event_id=? AND name=?').bind(hashed, id, input.name)).run();
      return result.meta.changes ? reply({invite}) : fail('Name nicht gefunden.', 404);
    }

    if (path === '/admin/invitees' && req.method === 'POST') {
      const input = await body(req);
      if (!validName(input.name)) return fail('Name prüfen.', 400);
      const name = input.name.trim();
      const result = await (id === legacyEventId
        ? db.prepare('INSERT INTO invitees(name) VALUES(?) ON CONFLICT(name) DO NOTHING').bind(name)
        : db.prepare('INSERT INTO future_invitees(event_id,name) VALUES(?,?) ON CONFLICT(event_id,name) DO NOTHING').bind(id, name)).run();
      return result.meta.changes ? reply({ok: true}) : fail('Der Name steht bereits auf dieser Einladungsliste.', 409);
    }

    if (path === '/admin/invitees' && req.method === 'DELETE') {
      const input = await body(req);
      if (!validName(input.name)) return fail('Name prüfen.', 400);
      const name = input.name.trim();
      const statements = id === legacyEventId
        ? [
            db.prepare('DELETE FROM rsvps WHERE name=?').bind(name),
            db.prepare('DELETE FROM invitees WHERE name=?').bind(name)
          ]
        : [
            db.prepare('DELETE FROM future_rsvps WHERE event_id=? AND name=?').bind(id, name),
            db.prepare('DELETE FROM future_invitees WHERE event_id=? AND name=?').bind(id, name)
          ];
      const [, removed] = await db.batch(statements);
      return removed.meta.changes ? reply({ok: true}) : fail('Name nicht gefunden.', 404);
    }

    if (path === '/admin/invitees' && req.method === 'PUT') {
      const input = await body(req);
      if (!validName(input.oldName) || !validName(input.newName)) return fail('Name prüfen.', 400);
      const name = input.newName.trim();
      const existing = await (id === legacyEventId
        ? db.prepare('SELECT name FROM invitees WHERE name=?').bind(name)
        : db.prepare('SELECT name FROM future_invitees WHERE event_id=? AND name=?').bind(id, name)).first();
      if (existing && name !== input.oldName) return fail('Der Name steht bereits auf dieser Einladungsliste.', 409);
      const result = await (id === legacyEventId
        ? db.prepare('UPDATE invitees SET name=? WHERE name=?').bind(name, input.oldName)
        : db.prepare('UPDATE future_invitees SET name=? WHERE event_id=? AND name=?').bind(name, id, input.oldName)).run();
      return result.meta.changes ? reply({ok: true}) : fail('Name nicht gefunden.', 404);
    }

    return fail('Nicht gefunden.', 404);
  } catch (err) {
    return err instanceof SyntaxError ? fail('Ungültige Eingabe.', 400) : fail('Serverfehler.', 500);
  }
}};
