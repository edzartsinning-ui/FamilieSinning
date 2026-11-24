(() => {
  const api = (window.FAMILIE_API_URL || '').replace(/\/$/, '');
  const $ = (id) => document.getElementById(id);
  const status = $('status'), feedback = $('feedback'), adminStatus = $('adminStatus');
  const adminLogin = $('adminLogin'), adminPanel = $('adminPanel');
  const loginStatus = $('adminLoginStatus'), inviteeAddStatus = $('inviteeAddStatus');
  const adminDetails = $('verwaltung').querySelector('details');

  function openAdminFromHash() {
    if (location.hash === '#verwaltung') adminDetails.open = true;
  }
  window.addEventListener('hashchange', openAdminFromHash);
  openAdminFromHash();

  let guestToken = sessionStorage.getItem('familie_guest') || '';
  let adminToken = sessionStorage.getItem('familie_admin') || '';
  async function request(path, method = 'GET', body, token) {
    if (!api) throw new Error('Die Anmeldung ist noch nicht freigeschaltet.');
    let r;
    try {
      r = await fetch(api + path, {method, headers: {'Content-Type':'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})}, body: body ? JSON.stringify(body) : undefined, cache:'no-store'});
    } catch {
      throw new Error('Der Anmeldeserver ist gerade nicht erreichbar. Bitte versuche es erneut.');
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const error = new Error(data.error || 'Die Anfrage konnte nicht verarbeitet werden.');
      if (r.status === 401 && path.startsWith('/admin/') && token && token === adminToken) {
        endAdminSession();
        showError(loginStatus, new Error('Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.'));
      }
      throw error;
    }
    return data;
  }
  function showError(el, err) { el.textContent = err.message || String(err); el.style.color = '#ff8aaf'; }
  function renderStatus(data) {
    const s = data.status;
    status.textContent = s === 'open' ? 'Anmeldung geöffnet' : s === 'closed' ? 'Anmeldung geschlossen. Die Veranstaltungsinfos bleiben verfügbar.' : 'Diese Veranstaltung ist beendet. Bis zum nächsten Mal!';
    $('rsvpForm').hidden = s !== 'open' || !guestToken;
    $('accessNotice').hidden = s === 'rest' || !!guestToken;
    if (s === 'rest') { document.querySelector('#infos').hidden = true; document.querySelector('.feature').hidden = true; }
  }
  async function refresh() { try { renderStatus(await request('/status')); } catch (e) { showError(status,e); $('rsvpForm').hidden=true; } }
  async function loadGuest() { const d=await request('/guest/event','GET',null,guestToken); $('inviteeName').textContent=d.name; document.querySelector('#infos').hidden=false; document.querySelector('.feature').hidden=false; const cards=document.querySelectorAll('.card'); cards[0].querySelector('strong').textContent=new Intl.DateTimeFormat('de-DE',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'Europe/Berlin'}).format(new Date(d.event.date+'T12:00:00Z')); cards[0].querySelector('p').textContent='Treffen um '+d.event.time+' Uhr'; cards[1].querySelector('strong').textContent=d.event.place; cards[2].querySelector('strong').textContent=d.event.activity; document.querySelector('.lead').textContent=d.event.title+' – '+d.event.activity+'.'; document.querySelector('.signup .section-head p').textContent='Bitte antworte bis einschließlich '+new Intl.DateTimeFormat('de-DE',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'Europe/Berlin'}).format(new Date(d.event.deadline+'T12:00:00Z'))+'.'; }
  const personalLink=location.hash.startsWith('#invite=')?decodeURIComponent(location.hash.slice(8)):null;if(personalLink){history.replaceState(null,'',location.pathname+location.search);request('/guest/login','POST',{invite:personalLink}).then(async d=>{guestToken=d.token;sessionStorage.setItem('familie_guest',guestToken);await refresh();await loadGuest();}).catch(err=>showError(feedback,err));}
  $('rsvpForm').addEventListener('submit', async e => { e.preventDefault(); feedback.textContent=''; try { const answer=new FormData(e.target).get('answer'), message=$('message').value.trim(); await request('/rsvp','POST',{answer,message},guestToken); feedback.style.color='#00e9ee'; feedback.textContent='Danke! Deine Antwort wurde gespeichert.'; e.target.reset(); } catch(err){showError(feedback,err);} });
  function endAdminSession() {
    adminToken = '';
    sessionStorage.removeItem('familie_admin');
    adminPanel.hidden = true;
    adminLogin.hidden = false;
    loginStatus.textContent = '';
    inviteeAddStatus.textContent = '';
    $('generatedLink').replaceChildren();
  }

  adminLogin.addEventListener('submit', async e => {
    e.preventDefault();
    const button = e.submitter || adminLogin.querySelector('button');
    const password = $('adminPassword');
    button.disabled = true;
    loginStatus.style.color = '';
    loginStatus.textContent = 'Anmeldung läuft …';
    try {
      const data = await request('/admin/login', 'POST', {password: password.value});
      adminToken = data.token;
      sessionStorage.setItem('familie_admin', adminToken);
      password.value = '';
      await loadAdmin();
      loginStatus.textContent = '';
    } catch (err) {
      if (loginStatus.textContent === 'Anmeldung läuft …') showError(loginStatus, err);
    } finally {
      button.disabled = false;
    }
  });
  $('logout').addEventListener('click', endAdminSession);

  async function loadAdmin(){ const d=await request('/admin/data','GET',null,adminToken); adminPanel.hidden=false;adminLogin.hidden=true;adminStatus.style.color='';adminStatus.textContent=`${d.rsvps.length} Antworten gespeichert.`;const rows=$('rsvpRows');rows.replaceChildren();for(const item of d.rsvps){const tr=document.createElement('tr');for(const value of [item.name,item.answer==='yes'?'Zusage':'Absage',item.message||'—',item.updated_at]){const td=document.createElement('td');td.textContent=value;tr.append(td);}rows.append(tr);} $('inviteeList').replaceChildren(...d.invitees.map(n=>{const li=document.createElement('li');const span=document.createElement('span');span.textContent=n+' ';const b=document.createElement('button');b.type='button';b.className='button ghost';b.textContent='Persönlichen Link erstellen';b.addEventListener('click',async()=>{try{const result=await request('/admin/link','POST',{name:n},adminToken);const url=new URL(location.href);url.search='';url.hash='invite='+encodeURIComponent(result.invite);const field=$('generatedLink');field.replaceChildren(document.createTextNode(n+': '));const a=document.createElement('a');a.href=url.href;a.textContent=url.href;field.append(a);await navigator.clipboard.writeText(url.href).catch(()=>{});}catch(err){showError(adminStatus,err);}});li.append(span,b);return li;}));$('oldName').replaceChildren(new Option('Bitte auswählen',''),...d.invitees.map(n=>new Option(n,n)));const f=$('eventForm');for(const k of ['title','date','time','place','activity','deadline','restFrom']) f.elements[k].value=d.event[k]||'';f.elements.active.checked=!!d.event.active; }
  $('inviteeAdd').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.currentTarget;
    const button = e.submitter || form.querySelector('button');
    const field = form.elements.inviteeName;
    const name = field.value.trim();
    if (!name) {
      showError(inviteeAddStatus, new Error('Bitte gib einen Namen ein.'));
      field.focus();
      return;
    }

    button.disabled = true;
    inviteeAddStatus.style.color = '';
    inviteeAddStatus.textContent = 'Name wird gespeichert …';
    try {
      await request('/admin/invitees', 'POST', {name}, adminToken);
      if (field.value.trim() === name) field.value = '';
      inviteeAddStatus.style.color = '#00e9ee';
      inviteeAddStatus.textContent = name + ' wurde hinzugefügt.';
      try {
        await loadAdmin();
      } catch {
        if (adminToken) {
          showError(inviteeAddStatus, new Error(name + ' wurde gespeichert. Die Liste konnte gerade nicht aktualisiert werden.'));
        }
      }
    } catch (err) {
      if (adminToken) showError(inviteeAddStatus, err);
    } finally {
      button.disabled = false;
    }
  });
  $('inviteeRename').addEventListener('submit',async e=>{e.preventDefault();try{await request('/admin/invitees','PUT',{oldName:$('oldName').value,newName:$('newName').value},adminToken);e.target.reset();await loadAdmin();}catch(err){showError(adminStatus,err);}});
  $('eventForm').addEventListener('submit',async e=>{e.preventDefault();const f=e.target;const event={};for(const k of ['title','date','time','place','activity','deadline','restFrom'])event[k]=f.elements[k].value.trim();event.active=f.elements.active.checked;try{await request('/admin/event','PUT',event,adminToken);adminStatus.style.color='#00e9ee';adminStatus.textContent='Veranstaltung gespeichert.';await refresh();}catch(err){showError(adminStatus,err);}});
  $('export').addEventListener('click',async()=>{try{const d=await request('/admin/data','GET',null,adminToken);const lines=[['Name','Antwort','Nachricht','Zeit'],...d.rsvps.map(x=>[x.name,x.answer==='yes'?'Zusage':'Absage',x.message||'',x.updated_at])];const csv='\uFEFF'+lines.map(row=>row.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(';')).join('\r\n');const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));link.download='teilnehmerliste.csv';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);}catch(err){showError(adminStatus,err);}});
  $('exportLinks').addEventListener('click',async()=>{const button=$('exportLinks');button.disabled=true;try{const d=await request('/admin/data','GET',null,adminToken);if(!d.invitees.length)throw new Error('Bitte zuerst eingeladene Personen hinzufügen.');const lines=[['Name','Persönlicher Link']];for(const name of d.invitees){const result=await request('/admin/link','POST',{name},adminToken);const url=new URL(location.href);url.search='';url.hash='invite='+encodeURIComponent(result.invite);lines.push([name,url.href]);}const csv='\uFEFF'+lines.map(row=>row.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(';')).join('\r\n');const href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=href;link.download='persoenliche-einladungslinks.csv';link.click();setTimeout(()=>URL.revokeObjectURL(href),1000);adminStatus.textContent=lines.length-1+' persönliche Links heruntergeladen. Die Datei bitte privat aufbewahren.';}catch(err){showError(adminStatus,err);}finally{button.disabled=false;}});
  refresh().then(()=>{if(guestToken)loadGuest().catch(()=>{guestToken='';sessionStorage.removeItem('familie_guest');refresh();});});if(adminToken)loadAdmin().catch(err => {
    if (adminToken) showError(loginStatus, err);
  });
})();
