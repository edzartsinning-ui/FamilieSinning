const enc = new TextEncoder();
const json = (data, status=200, extra={}) => new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extra}});
function base64url(bytes){return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function unbase64url(s){return Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));}
async function hmac(secret,data){const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return base64url(new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(data))));}
function equal(a,b){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
async function token(env,role,name=null){const payload=base64url(enc.encode(JSON.stringify({role,name,exp:Date.now()+8*3600_000})));return payload+'.'+await hmac(env.TOKEN_SECRET,payload);}
async function verify(req,env,role){const auth=req.headers.get('Authorization')||'';const m=/^Bearer ([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(auth);if(!m)return false;const sig=await hmac(env.TOKEN_SECRET,m[1]);if(!equal(sig,m[2]))return false;try{const p=JSON.parse(new TextDecoder().decode(unbase64url(m[1])));return p.role===role&&p.exp>Date.now()?p:null;}catch{return null;}}
function berlinDate(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function status(event){const today=berlinDate();if(!event.active||today>=event.rest_from)return'rest';if(today>event.deadline)return'closed';return'open';}
async function body(req){const t=await req.text();if(t.length>4000)throw new Error('Eingabe zu lang.');return JSON.parse(t||'{}');}
async function throttle(req,env,kind){const ip=req.headers.get('CF-Connecting-IP')||'unknown';const key=kind+':'+await hmac(env.TOKEN_SECRET,ip);const now=Date.now();const row=await env.DB.prepare('SELECT count,reset_at FROM login_attempts WHERE key=?').bind(key).first();if(row&&row.reset_at>now&&row.count>=10)return false;await env.DB.prepare('INSERT INTO login_attempts(key,count,reset_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset_at<? THEN 1 ELSE count+1 END, reset_at=CASE WHEN reset_at<? THEN ? ELSE reset_at END').bind(key,1,now+900000,now,now,now+900000).run();return true;}
export default {async fetch(req,env){
  const origin=req.headers.get('Origin');const allowed=origin===env.ALLOWED_ORIGIN;
  const cors=allowed?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET, POST, PUT, OPTIONS','Vary':'Origin'}:{};
  if(req.method==='OPTIONS')return new Response(null,{status:allowed?204:403,headers:cors});
  if(origin&&!allowed)return json({error:'Zugriff nicht erlaubt.'},403,cors);
  if(!env.DB||!env.ADMIN_PASSWORD||!env.TOKEN_SECRET||!env.ALLOWED_ORIGIN)return json({error:'Server noch nicht eingerichtet.'},503,cors);
  const u=new URL(req.url), path=u.pathname;
  try{
    const event=await env.DB.prepare('SELECT * FROM events WHERE id=1').first();
    const state=event?status(event):'rest';
    if(path==='/status'&&req.method==='GET')return json({status:state},200,cors);
    if(path==='/guest/login'&&req.method==='POST'){
      if(state==='rest')return json({error:'Diese Veranstaltung ist beendet.'},403,cors);
      if(!await throttle(req,env,'guest'))return json({error:'Zu viele Versuche. Bitte später erneut versuchen.'},429,cors);
      const input=await body(req);if(typeof input.invite!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(input.invite))return json({error:'Einladungslink ungültig.'},401,cors);
      const hashed=await hmac(env.TOKEN_SECRET,input.invite);const person=await env.DB.prepare('SELECT name FROM invitees WHERE invite_token_hash=?').bind(hashed).first();if(!person)return json({error:'Einladungslink ungültig.'},401,cors);
      return json({token:await token(env,'guest',person.name)},200,cors);
    }
    if(path==='/guest/event'&&req.method==='GET'){
      const guest=await verify(req,env,'guest');if(!guest)return json({error:'Persönlichen Einladungslink öffnen.'},401,cors);
      if(state==='rest')return json({error:'Diese Veranstaltung ist beendet.'},403,cors);
      const person=await env.DB.prepare('SELECT name FROM invitees WHERE name=?').bind(guest.name).first();if(!person)return json({error:'Einladung nicht mehr gültig.'},403,cors);
      return json({event:{title:event.title,date:event.date,time:event.time,place:event.place,activity:event.activity,deadline:event.deadline},name:guest.name,status:state},200,cors);
    }
    if(path==='/rsvp'&&req.method==='POST'){
      const guest=await verify(req,env,'guest');if(!guest)return json({error:'Persönlichen Einladungslink öffnen.'},401,cors);
      if(state!=='open')return json({error:'Die Anmeldung ist geschlossen.'},403,cors);
      const input=await body(req);if(!['yes','no'].includes(input.answer)||typeof input.message!=='string'||input.message.length>1000)return json({error:'Bitte Eingaben prüfen.'},400,cors);
      const invited=await env.DB.prepare('SELECT name FROM invitees WHERE name=?').bind(guest.name).first();if(!invited)return json({error:'Einladung nicht mehr gültig.'},403,cors);
      await env.DB.prepare('INSERT INTO rsvps(name,answer,message,updated_at) VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET answer=excluded.answer,message=excluded.message,updated_at=excluded.updated_at').bind(guest.name,input.answer,input.message.trim(),new Date().toISOString()).run();
      return json({ok:true},200,cors);
    }
    if(path==='/admin/login'&&req.method==='POST'){
      if(!await throttle(req,env,'admin'))return json({error:'Zu viele Versuche. Bitte später erneut versuchen.'},429,cors);
      const input=await body(req);if(typeof input.password!=='string'||!equal(await hmac(env.TOKEN_SECRET,input.password),await hmac(env.TOKEN_SECRET,env.ADMIN_PASSWORD)))return json({error:'Passwort ungültig.'},401,cors);
      return json({token:await token(env,'admin')},200,cors);
    }
    if(path.startsWith('/admin/')){
      if(!await verify(req,env,'admin'))return json({error:'Nicht angemeldet.'},401,cors);
      if(path==='/admin/data'&&req.method==='GET'){
        const rsvps=(await env.DB.prepare('SELECT name,answer,message,updated_at FROM rsvps ORDER BY name').all()).results;
        return json({event:event?{title:event.title,date:event.date,time:event.time,place:event.place,activity:event.activity,deadline:event.deadline,restFrom:event.rest_from,active:!!event.active}:{title:'',date:'',time:'',place:'',activity:'',deadline:'',restFrom:'',active:false},rsvps,invitees:(await env.DB.prepare('SELECT name FROM invitees ORDER BY name').all()).results.map(x=>x.name)},200,cors);
      }
      if(path==='/admin/event'&&req.method==='PUT'){
        const input=await body(req);for(const k of ['title','date','time','place','activity','deadline','restFrom'])if(typeof input[k]!=='string'||!input[k]||input[k].length>160)return json({error:'Bitte alle Felder ausfüllen.'},400,cors);
        if(!/^\d{4}-\d{2}-\d{2}$/.test(input.date)||!/^\d{2}:\d{2}$/.test(input.time)||!/^\d{4}-\d{2}-\d{2}$/.test(input.deadline)||!/^\d{4}-\d{2}-\d{2}$/.test(input.restFrom)||input.deadline>=input.restFrom)return json({error:'Datumsangaben prüfen.'},400,cors);
        await env.DB.prepare('INSERT INTO events(id,title,date,time,place,activity,deadline,rest_from,active) VALUES(1,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,date=excluded.date,time=excluded.time,place=excluded.place,activity=excluded.activity,deadline=excluded.deadline,rest_from=excluded.rest_from,active=excluded.active').bind(input.title,input.date,input.time,input.place,input.activity,input.deadline,input.restFrom,input.active?1:0).run();return json({ok:true},200,cors);
      }
      if(path==='/admin/link'&&req.method==='POST'){const input=await body(req);if(typeof input.name!=='string')return json({error:'Name prüfen.'},400,cors);const person=await env.DB.prepare('SELECT name FROM invitees WHERE name=?').bind(input.name).first();if(!person)return json({error:'Name nicht gefunden.'},404,cors);const raw=base64url(crypto.getRandomValues(new Uint8Array(32)));const hashed=await hmac(env.TOKEN_SECRET,raw);await env.DB.prepare('UPDATE invitees SET invite_token_hash=? WHERE name=?').bind(hashed,input.name).run();return json({invite:raw},200,cors);}
      if(path==='/admin/invitees'&&req.method==='POST'){const input=await body(req);if(typeof input.name!=='string'||!input.name.trim()||input.name.length>100)return json({error:'Name prüfen.'},400,cors);await env.DB.prepare('INSERT INTO invitees(name) VALUES(?)').bind(input.name.trim()).run();return json({ok:true},200,cors);}
      if(path==='/admin/invitees'&&req.method==='PUT'){
        const input=await body(req);if(typeof input.oldName!=='string'||typeof input.newName!=='string'||!input.newName.trim()||input.newName.length>100)return json({error:'Name prüfen.'},400,cors);
        const old=await env.DB.prepare('SELECT name FROM invitees WHERE name=?').bind(input.oldName).first();if(!old)return json({error:'Name nicht gefunden.'},404,cors);
        await env.DB.prepare('UPDATE invitees SET name=? WHERE name=?').bind(input.newName.trim(),input.oldName).run();return json({ok:true},200,cors);
      }
    }
    return json({error:'Nicht gefunden.'},404,cors);
  }catch(e){return json({error:e instanceof SyntaxError?'Ungültige Eingabe.':'Serverfehler.'},e instanceof SyntaxError?400:500,cors);}
}};
