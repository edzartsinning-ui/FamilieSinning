(() => {
  const api = (window.FAMILIE_API_URL || '').replace(/\/$/, '');
  const $ = (id) => document.getElementById(id);
  const status = $('status'), feedback = $('feedback'), adminStatus = $('adminStatus');
  const adminLogin = $('adminLogin'), adminPanel = $('adminPanel');
  const loginStatus = $('adminLoginStatus'), inviteeAddStatus = $('inviteeAddStatus');
  const eventSelect = $('eventSelect'), archiveSelect = $('archiveSelect');
  const eventArchive = $('eventArchive'), eventForm = $('eventForm');
  const eventContents = $('eventContents'), eventStatus = $('eventStatus');
  const eventWebsiteField = $('eventWebsiteField');
  const eventFields = ['title', 'date', 'time', 'place', 'activity', 'deadline', 'restFrom'];
  const adminDetails = $('verwaltung').querySelector('details');

  function openAdminFromHash() {
    if (location.hash === '#verwaltung') adminDetails.open = true;
  }
  window.addEventListener('hashchange', openAdminFromHash);
  openAdminFromHash();

  const rsvpForm = $('rsvpForm');
  const guestLead = document.querySelector('.lead');
  const guestWebsite = $('guestWebsite');
  const signupDeadline = $('signupDeadline');
  const defaultLead = guestLead.textContent;
  const defaultDeadline = signupDeadline.textContent;
  let guestToken = sessionStorage.getItem('familie_guest') || '';
  let guestVerified = false;
  let guestRequest = 0;
  let adminToken = sessionStorage.getItem('familie_admin') || '';
  let eventId = null;
  let eventSelection = 0;
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
    const state = data.status;
    status.textContent = state === 'open' ? 'Anmeldung geöffnet' : state === 'closed' ? 'Anmeldung geschlossen. Die Veranstaltungsinfos bleiben verfügbar.' : 'Diese Veranstaltung ist beendet. Bis zum nächsten Mal!';
    rsvpForm.hidden = state !== 'open' || !guestVerified;
    $('accessNotice').hidden = state === 'rest' || guestVerified;
    if (state === 'rest') hideGuestDetails();
  }

  function hideGuestDetails() {
    guestVerified = false;
    $('defaultHeading').hidden = false;
    $('guestHeading').hidden = true;
    $('guestName').textContent = '';
    $('inviteeName').textContent = '';
    $('signupHeading').textContent = 'Bist du dabei?';
    $('infos').hidden = true;
    guestWebsite.hidden = true;
    guestWebsite.removeAttribute('href');
    guestLead.textContent = defaultLead;
    signupDeadline.textContent = defaultDeadline;
    rsvpForm.hidden = true;
    rsvpForm.reset();
  }

  async function refresh() {
    const attempt = guestRequest;
    try {
      const data = guestVerified
        ? await request('/guest/event', 'GET', null, guestToken)
        : await request('/status');
      if (attempt === guestRequest) renderStatus(data);
    } catch (err) {
      if (attempt !== guestRequest) return;
      if (guestVerified) hideGuestDetails();
      showError(status, err);
    }
  }

  function showGuestDetails(data) {
    const {name, event} = data;
    const dateFormat = new Intl.DateTimeFormat('de-DE', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Berlin'
    });
    const deadlineFormat = new Intl.DateTimeFormat('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin'
    });
    const cards = document.querySelectorAll('.card');
    cards[0].querySelector('strong').textContent = dateFormat.format(new Date(event.date + 'T12:00:00Z'));
    cards[0].querySelector('p').textContent = 'Treffen um ' + event.time + ' Uhr';
    cards[1].querySelector('strong').textContent = event.place;
    cards[2].querySelector('strong').textContent = event.activity;
    guestLead.textContent = event.title + ' – ' + event.activity + '.';
    signupDeadline.textContent = 'Bitte antworte bis einschließlich ' + deadlineFormat.format(new Date(event.deadline + 'T12:00:00Z')) + '.';
    $('guestName').textContent = name;
    $('inviteeName').textContent = name;
    $('signupHeading').textContent = 'Bist du dabei, ' + name + '?';
    $('defaultHeading').hidden = true;
    $('guestHeading').hidden = false;
    $('infos').hidden = false;
    if (typeof event.websiteUrl === 'string' && /^https?:\/\//i.test(event.websiteUrl)) {
      guestWebsite.href = event.websiteUrl;
      guestWebsite.hidden = false;
    }
    guestVerified = true;
    renderStatus(data);
  }

  async function openInvitation() {
    const personalLink = location.hash.startsWith('#invite=');
    const invite = personalLink ? location.hash.slice(8) : '';
    const attempt = ++guestRequest;
    hideGuestDetails();
    feedback.textContent = '';
    if (personalLink) {
      history.replaceState(null, '', location.pathname + location.search);
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      guestToken = '';
      sessionStorage.removeItem('familie_guest');
    }
    if (!personalLink && !guestToken) {
      await refresh();
      return;
    }

    try {
      let token = guestToken;
      if (personalLink) token = (await request('/guest/login', 'POST', {invite})).token;
      if (attempt !== guestRequest) return;
      const data = await request('/guest/event', 'GET', null, token);
      if (attempt !== guestRequest) return;
      showGuestDetails(data);
      if (personalLink) $('guestHeading').focus({ preventScroll: true });
      guestToken = token;
      sessionStorage.setItem('familie_guest', token);
    } catch (err) {
      if (attempt !== guestRequest) return;
      guestToken = '';
      sessionStorage.removeItem('familie_guest');
      showError(feedback, err);
      await refresh();
    }
  }
  window.addEventListener('hashchange', () => {
    if (location.hash.startsWith('#invite=')) openInvitation();
  });

  rsvpForm.addEventListener('submit', async e => {
    e.preventDefault();
    if (!guestVerified) return;
    const attempt = guestRequest;
    const answer = new FormData(rsvpForm).get('answer');
    const message = $('message').value.trim();
    const button = e.submitter || rsvpForm.querySelector('button');
    button.disabled = true;
    feedback.textContent = '';
    try {
      await request('/rsvp', 'POST', {answer, message}, guestToken);
      if (attempt === guestRequest) {
        feedback.style.color = '#00e9ee';
        feedback.textContent = answer === 'yes' ? 'Deine Zusage wurde gespeichert.' : 'Deine Absage wurde gespeichert.';
      }
    } catch (err) {
      if (attempt === guestRequest) {
        showError(feedback, err);
        await refresh();
      }
    } finally {
      button.disabled = false;
    }
  });

  function endAdminSession() {
    eventSelection++;
    eventId = null;
    eventContents.hidden = true;
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

  const eventDate = new Intl.DateTimeFormat('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin'
  });

  function eventRequest(path, id, method, data) {
    return request(path + '?event=' + encodeURIComponent(id), method, data, adminToken);
  }

  function fillEventSelect(select, events, emptyText) {
    const placeholder = new Option(events.length ? 'Veranstaltung auswählen' : emptyText, '');
    placeholder.disabled = true;
    const options = events.map(event => {
      const date = eventDate.format(new Date(event.date + 'T12:00:00Z'));
      const label = date + ' · ' + event.title + (event.active ? '' : ' (inaktiv)');
      return new Option(label, String(event.id));
    });
    select.replaceChildren(placeholder, ...options);
    select.disabled = !events.length;
    select.value = '';
  }

  async function loadEventList(preferredId) {
    const {events, canEditWebsite} = await request('/admin/events', 'GET', null, adminToken);
    eventWebsiteField.hidden = !canEditWebsite;
    const today = new Intl.DateTimeFormat('sv-SE', {
      year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Berlin'
    }).format(new Date());
    const upcoming = events.filter(event => event.date >= today);
    const archived = events.filter(event => event.date < today).reverse();
    fillEventSelect(eventSelect, upcoming, 'Keine bevorstehenden Veranstaltungen');
    fillEventSelect(archiveSelect, archived, 'Keine vergangenen Veranstaltungen');
    $('eventArchiveLabel').textContent = `Archiv (${archived.length})`;
    const preferred = events.find(event => event.id === preferredId);
    return preferred?.id ?? upcoming[0]?.id ?? null;
  }

  async function loadAdmin() {
    const id = await loadEventList(eventId);
    adminPanel.hidden = false;
    adminLogin.hidden = true;
    if (id !== null) await selectEvent(id);
    else eventArchive.open = false;
  }

  function fillEventForm(event = {}) {
    for (const key of eventFields) eventForm.elements[key].value = event[key] || '';
    eventForm.elements.active.checked = !!event.active;
    eventForm.elements.websiteUrl.value = event.websiteUrl || '';
  }

  async function selectEvent(id) {
    const selection = ++eventSelection;
    eventId = id;
    const value = id === null ? '' : String(id);
    const inArchive = id !== null && Array.from(archiveSelect.options).some(option => option.value === value);
    eventSelect.value = inArchive ? '' : value;
    archiveSelect.value = inArchive ? value : '';
    eventArchive.open = inArchive;
    eventContents.hidden = true;
    adminStatus.textContent = '';
    adminStatus.style.color = '';
    eventStatus.textContent = '';
    $('generatedLink').replaceChildren();
    $('inviteeAdd').reset();
    $('inviteeRename').reset();
    inviteeAddStatus.textContent = '';
    $('eventPeople').hidden = id === null;
    $('eventFormTitle').textContent = id === null ? 'Neue Veranstaltung' : 'Veranstaltung bearbeiten';
    $('eventSave').textContent = id === null ? 'Veranstaltung anlegen' : 'Speichern';
    if (id === null) {
      fillEventForm();
      eventContents.hidden = false;
      eventForm.elements.title.focus();
      return;
    }

    adminStatus.textContent = 'Veranstaltung wird geladen …';
    try {
      const data = await eventRequest('/admin/data', id);
      if (selection !== eventSelection) return;
      renderPeople(data, id);
      fillEventForm(data.event);
      adminStatus.textContent = '';
      eventContents.hidden = false;
    } catch (err) {
      if (selection === eventSelection) showError(adminStatus, err);
    }
  }

  eventSelect.addEventListener('change', () => selectEvent(Number(eventSelect.value)));
  archiveSelect.addEventListener('change', () => selectEvent(Number(archiveSelect.value)));
  $('newEvent').addEventListener('click', () => selectEvent(null));

  function renderPeople(data, id) {
    $('responseCount').textContent = `Antworten (${data.rsvps.length})`;
    const rows = $('rsvpRows');
    rows.replaceChildren();
    for (const item of data.rsvps) {
      const row = document.createElement('tr');
      for (const value of [item.name, item.answer === 'yes' ? 'Zusage' : 'Absage', item.message || '—', item.updated_at]) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      rows.append(row);
    }

    $('inviteeList').replaceChildren(...data.invitees.map(name => {
      const item = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = name + ' ';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button ghost';
      button.textContent = 'Persönlichen Link erstellen';
      button.addEventListener('click', async () => {
        const selection = eventSelection;
        button.disabled = true;
        try {
          const result = await eventRequest('/admin/link', id, 'POST', {name});
          if (selection !== eventSelection) return;
          const href = invitationUrl(result.invite);
          const field = $('generatedLink');
          const link = document.createElement('a');
          link.href = href;
          link.textContent = href;
          field.replaceChildren(document.createTextNode(name + ': '), link);
          await navigator.clipboard?.writeText(href).catch(() => {});
        } catch (err) {
          if (selection === eventSelection) showError(adminStatus, err);
        } finally {
          button.disabled = false;
        }
      });
      item.append(label, button);
      if (data.canDeleteInvitees) {
        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'button ghost';
        removeButton.textContent = 'Entfernen';
        removeButton.setAttribute('aria-label', name + ' entfernen');
        removeButton.addEventListener('click', async () => {
          if (!window.confirm(name + ' aus dieser Veranstaltung entfernen? Der Einladungslink wird ungültig und eine vorhandene Antwort wird gelöscht.')) return;
          const selection = eventSelection;
          removeButton.disabled = true;
          button.disabled = true;
          try {
            await eventRequest('/admin/invitees', id, 'DELETE', {name});
            if (selection !== eventSelection) return;
            $('generatedLink').replaceChildren();
            adminStatus.style.color = '';
            adminStatus.textContent = name + ' wurde entfernt.';
            try {
              await refreshPeople(id, selection);
            } catch {
              if (selection === eventSelection) {
                showError(adminStatus, new Error(name + ' wurde entfernt. Die Liste konnte gerade nicht aktualisiert werden.'));
              }
            }
          } catch (err) {
            if (selection === eventSelection) showError(adminStatus, err);
          } finally {
            removeButton.disabled = false;
            button.disabled = false;
          }
        });
        item.append(document.createTextNode(' '), removeButton);
      }
      return item;
    }));
    $('oldName').replaceChildren(new Option('Bitte auswählen', ''), ...data.invitees.map(name => new Option(name, name)));
  }

  async function refreshPeople(id, selection) {
    const data = await eventRequest('/admin/data', id);
    if (selection === eventSelection) renderPeople(data, id);
  }

  $('inviteeAdd').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.currentTarget;
    const button = e.submitter || form.querySelector('button');
    const field = form.elements.inviteeName;
    const name = field.value.trim();
    const id = eventId, selection = eventSelection;
    if (!name) {
      showError(inviteeAddStatus, new Error('Bitte gib einen Namen ein.'));
      field.focus();
      return;
    }

    button.disabled = true;
    inviteeAddStatus.style.color = '';
    inviteeAddStatus.textContent = 'Name wird gespeichert …';
    try {
      await eventRequest('/admin/invitees', id, 'POST', {name});
      if (selection !== eventSelection) return;
      if (field.value.trim() === name) field.value = '';
      inviteeAddStatus.style.color = '#00e9ee';
      inviteeAddStatus.textContent = name + ' wurde hinzugefügt.';
      try {
        await refreshPeople(id, selection);
      } catch {
        if (selection === eventSelection) {
          showError(inviteeAddStatus, new Error(name + ' wurde gespeichert. Die Liste konnte gerade nicht aktualisiert werden.'));
        }
      }
    } catch (err) {
      if (selection === eventSelection) showError(inviteeAddStatus, err);
    } finally {
      button.disabled = false;
    }
  });

  $('inviteeRename').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.currentTarget;
    const selection = eventSelection, id = eventId;
    const button = e.submitter || form.querySelector('button');
    button.disabled = true;
    try {
      await eventRequest('/admin/invitees', id, 'PUT', {oldName: $('oldName').value, newName: $('newName').value});
      if (selection !== eventSelection) return;
      form.reset();
      await refreshPeople(id, selection);
    } catch (err) {
      if (selection === eventSelection) showError(adminStatus, err);
    } finally {
      button.disabled = false;
    }
  });

  eventForm.addEventListener('submit', async e => {
    e.preventDefault();
    const id = eventId, selection = eventSelection;
    const event = Object.fromEntries(eventFields.map(key => [key, eventForm.elements[key].value.trim()]));
    event.active = eventForm.elements.active.checked;
    if (!eventWebsiteField.hidden) event.websiteUrl = eventForm.elements.websiteUrl.value.trim();
    $('eventSave').disabled = true;
    eventSelect.inert = true;
    archiveSelect.inert = true;
    $('newEvent').disabled = true;
    eventStatus.style.color = '';
    eventStatus.textContent = 'Veranstaltung wird gespeichert …';

    try {
      const result = id === null
        ? await request('/admin/events', 'POST', event, adminToken)
        : await eventRequest('/admin/event', id, 'PUT', event);
      if (selection !== eventSelection) return;
      // Keep the saved ID even if reloading the list fails, so a retry updates this event.
      eventId = id ?? result.id;
      const savedId = eventId;
      await loadEventList(savedId);
      if (selection !== eventSelection) return;
      await selectEvent(savedId);
      if (eventId !== savedId) return;
      eventStatus.style.color = '#00e9ee';
      eventStatus.textContent = id === null ? 'Veranstaltung angelegt.' : 'Veranstaltung gespeichert.';
      await refresh();
    } catch (err) {
      if (selection === eventSelection) showError(eventStatus, err);
    } finally {
      $('eventSave').disabled = false;
      eventSelect.inert = false;
      archiveSelect.inert = false;
      $('newEvent').disabled = false;
    }
  });

  function downloadCsv(filename, lines) {
    const csv = '\uFEFF' + lines.map(row => row.map(value => '"' + String(value).replace(/"/g, '""') + '"').join(';')).join('\r\n');
    const href = URL.createObjectURL(new Blob([csv], {type: 'text/csv;charset=utf-8'}));
    const link = document.createElement('a');
    link.href = href;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  function invitationUrl(invite) {
    const url = new URL(location.href);
    url.search = '';
    url.hash = 'invite=' + encodeURIComponent(invite);
    return url.href;
  }

  $('export').addEventListener('click', async () => {
    const id = eventId, selection = eventSelection;
    try {
      const data = await eventRequest('/admin/data', id);
      if (selection !== eventSelection) return;
      const lines = [['Name', 'Antwort', 'Nachricht', 'Zeit'], ...data.rsvps.map(item => [
        item.name, item.answer === 'yes' ? 'Zusage' : 'Absage', item.message || '', item.updated_at
      ])];
      downloadCsv('teilnehmerliste.csv', lines);
    } catch (err) {
      if (selection === eventSelection) showError(adminStatus, err);
    }
  });

  $('exportLinks').addEventListener('click', async () => {
    const button = $('exportLinks');
    const id = eventId, selection = eventSelection;
    button.disabled = true;
    try {
      const data = await eventRequest('/admin/data', id);
      if (!data.invitees.length) throw new Error('Bitte zuerst eingeladene Personen hinzufügen.');
      const lines = [['Name', 'Persönlicher Link']];
      for (const name of data.invitees) {
        const result = await eventRequest('/admin/link', id, 'POST', {name});
        lines.push([name, invitationUrl(result.invite)]);
      }
      downloadCsv('persoenliche-einladungslinks.csv', lines);
      if (selection === eventSelection) {
        adminStatus.textContent = lines.length - 1 + ' persönliche Links heruntergeladen. Die Datei bitte privat aufbewahren.';
      }
    } catch (err) {
      if (selection === eventSelection) showError(adminStatus, err);
    } finally {
      button.disabled = false;
    }
  });
  openInvitation();
  if(adminToken)loadAdmin().catch(err => {
    if (adminToken) showError(loginStatus, err);
  });
})();
