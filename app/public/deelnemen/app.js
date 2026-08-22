(function () {
  'use strict';

  var sessionToken = null;
  var deviceBinding = createDeviceBinding();
  var statusEtag = null;
  var pollTimer = null;
  var currentStatus = null;
  var currentVote = null;
  var pendingChoice = null;

  var loginScreen = document.getElementById('loginScreen');
  var roundScreen = document.getElementById('roundScreen');
  var receiptScreen = document.getElementById('receiptScreen');
  var loginForm = document.getElementById('loginForm');
  var accessCode = document.getElementById('accessCode');
  var loginButton = document.getElementById('loginButton');
  var loginError = document.getElementById('loginError');
  var voteError = document.getElementById('voteError');
  var confirmDialog = document.getElementById('confirmDialog');

  loginForm.addEventListener('submit', login);
  document.querySelectorAll('[data-choice]').forEach(function (button) {
    button.addEventListener('click', function () { openConfirmation(button.dataset.choice); });
  });
  document.getElementById('confirmVoteButton').addEventListener('click', function (event) {
    event.preventDefault();
    submitVote();
  });
  document.getElementById('changeVoteButton').addEventListener('click', function () {
    showScreen(roundScreen);
    document.getElementById('motionTitle').focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  async function login(event) {
    event.preventDefault();
    clearNotice(loginError);
    var code = accessCode.value.trim();
    if (!code) {
      showNotice(loginError, 'Vul uw persoonlijke toegangscode in.');
      accessCode.focus();
      return;
    }
    loginButton.disabled = true;
    loginButton.textContent = 'Inloggen…';
    try {
      var response = await fetch('/deelnemen/api/login', {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code, deviceBinding: deviceBinding })
      });
      var result = await readResponse(response);
      sessionToken = result.sessionToken;
      accessCode.value = '';
      statusEtag = null;
      showScreen(roundScreen);
      await pollStatus(true);
    } catch (error) {
      showNotice(loginError, loginErrorMessage(error));
      accessCode.focus();
    } finally {
      loginButton.disabled = false;
      loginButton.textContent = 'Inloggen';
    }
  }

  async function pollStatus(immediate) {
    stopPolling();
    if (!sessionToken) return;
    try {
      var headers = authorizationHeaders();
      if (statusEtag) headers['If-None-Match'] = statusEtag;
      var response = await fetch('/deelnemen/api/status', {
        method: 'GET',
        credentials: 'omit',
        headers: headers
      });
      if (response.status === 304) {
        schedulePoll();
        return;
      }
      var status = await readResponse(response);
      statusEtag = response.headers.get('ETag');
      currentStatus = status;
      renderStatus(status);
      if (status.round) await loadCurrentVote(status.round.id);
      if (status.status === 'open' || status.status === 'waiting') schedulePoll();
      else stopPolling();
    } catch (error) {
      if (error.code === 'SESSION_INVALID' || error.status === 401) {
        return resetToLogin('Uw sessie is verlopen. Log opnieuw in.');
      }
      showNotice(voteError, immediate
        ? 'De vergaderstatus kon niet worden opgehaald. Probeer het opnieuw.'
        : 'De verbinding is tijdelijk onderbroken. We proberen het opnieuw.');
      schedulePoll();
    }
  }

  function renderStatus(status) {
    clearNotice(voteError);
    document.getElementById('meetingIdentity').hidden = false;
    document.getElementById('meetingCode').textContent = status.meeting.vveCode;
    document.getElementById('meetingDate').textContent = formatDate(status.meeting.date);
    document.getElementById('ownerName').textContent = status.participant.displayName;
    document.getElementById('ownerObject').textContent = status.participant.objectLabel;

    var statusStrip = document.getElementById('liveStatus');
    statusStrip.className = 'status-strip ' + (status.status === 'open' ? 'is-open' : status.status === 'waiting' ? '' : 'is-closed');
    document.getElementById('statusLabel').textContent = statusText(status.status);
    document.getElementById('remainingTime').textContent = status.status === 'open'
      ? formatRemaining(status.remainingSeconds)
      : '';

    var waitingCard = document.getElementById('waitingCard');
    var roundCard = document.getElementById('roundCard');
    waitingCard.hidden = Boolean(status.round);
    roundCard.hidden = !status.round;
    if (!status.round) return;

    document.getElementById('motionTitle').textContent = status.round.title;
    document.getElementById('motionTitle').tabIndex = -1;
    document.getElementById('roundNumber').textContent = 'ronde #' + status.round.id;
    renderScope(status.round.splitsingen, status.entitlements);
    renderEntitlements(status.entitlements);

    var voteField = document.getElementById('voteField');
    var eligibilityNotice = document.getElementById('eligibilityNotice');
    voteField.hidden = !status.eligible;
    eligibilityNotice.hidden = status.eligible;
    if (!status.eligible) {
      eligibilityNotice.textContent = status.status === 'open'
        ? 'Voor deze ronde is voor uw eigenaarstitel geen stemrecht geactiveerd.'
        : 'Deze stemronde is gesloten. Uw geregistreerde keuze blijft zichtbaar.';
    }
  }

  function renderScope(scope, entitlements) {
    var values = scope && scope.length
      ? scope
      : entitlements.map(function (item) { return item.splitsingCode; });
    var container = document.getElementById('scopeChips');
    container.replaceChildren();
    Array.from(new Set(values)).forEach(function (code) {
      var chip = document.createElement('span');
      chip.className = 'chip ' + splittingClass(code);
      chip.textContent = code;
      container.appendChild(chip);
    });
  }

  function renderEntitlements(entitlements) {
    var list = document.getElementById('entitlementList');
    list.replaceChildren();
    entitlements.forEach(function (entitlement) {
      var item = document.createElement('li');
      var chip = document.createElement('span');
      chip.className = 'chip ' + splittingClass(entitlement.splitsingCode);
      chip.textContent = entitlement.splitsingCode;
      var label = document.createElement('strong');
      label.textContent = 'Afzonderlijk stemrecht';
      var weight = document.createElement('span');
      weight.textContent = entitlement.weight;
      item.append(chip, label, weight);
      list.appendChild(item);
    });
    document.getElementById('fanoutExplanation').hidden = entitlements.length < 2;
  }

  async function loadCurrentVote(roundId) {
    try {
      var response = await fetch('/deelnemen/api/vote?roundId=' + encodeURIComponent(roundId), {
        method: 'GET',
        credentials: 'omit',
        headers: authorizationHeaders()
      });
      currentVote = await readResponse(response);
      renderCurrentVote(currentVote);
    } catch (error) {
      if (error.code === 'SESSION_INVALID' || error.status === 401) {
        resetToLogin('Uw sessie is verlopen. Log opnieuw in.');
      } else {
        showNotice(voteError, 'Uw huidige stem kon niet worden opgehaald.');
      }
    }
  }

  function renderCurrentVote(vote) {
    var panel = document.getElementById('currentVotePanel');
    panel.hidden = !vote;
    panel.className = 'current-vote' + (vote ? ' choice-' + vote.choice : '');
    document.getElementById('currentChoice').textContent = vote ? choiceLabel(vote.choice) : '';
  }

  function openConfirmation(choice) {
    if (!currentStatus || !currentStatus.eligible) return;
    pendingChoice = choice;
    document.getElementById('pendingChoice').textContent = choiceLabel(choice);
    var count = currentStatus.entitlements.length;
    document.getElementById('pendingCount').textContent = count + (count === 1 ? ' stemrecht' : ' stemrechten');
    confirmDialog.showModal();
  }

  async function submitVote() {
    if (!pendingChoice || !currentStatus || !currentStatus.round) return;
    var confirmButton = document.getElementById('confirmVoteButton');
    confirmButton.disabled = true;
    confirmButton.textContent = 'Registreren…';
    clearNotice(voteError);
    try {
      var response = await fetch('/deelnemen/api/vote', {
        method: 'POST',
        credentials: 'omit',
        headers: Object.assign({ 'Content-Type': 'application/json' }, authorizationHeaders()),
        body: JSON.stringify({ roundId: currentStatus.round.id, choice: pendingChoice })
      });
      await readResponse(response);
      confirmDialog.close();
      await loadCurrentVote(currentStatus.round.id);
      if (currentVote) renderReceipt(currentVote);
    } catch (error) {
      confirmDialog.close();
      if (error.code === 'ROUND_NOT_OPEN' || error.status === 409) {
        showNotice(voteError, 'De ronde is inmiddels gesloten. Uw stem is niet gewijzigd.');
        statusEtag = null;
        await pollStatus(true);
      } else if (error.code === 'SESSION_INVALID' || error.status === 401) {
        resetToLogin('Uw sessie is verlopen. Log opnieuw in.');
      } else {
        showNotice(voteError, 'Uw stem kon niet worden geregistreerd. Probeer het opnieuw.');
      }
    } finally {
      confirmButton.disabled = false;
      confirmButton.textContent = 'Bevestig stem';
    }
  }

  function renderReceipt(vote) {
    document.getElementById('receiptMotion').textContent = currentStatus.round.title;
    var choice = document.getElementById('receiptChoice');
    choice.textContent = choiceLabel(vote.choice);
    choice.className = 'choice-' + vote.choice;
    document.getElementById('receiptEntitlements').textContent = vote.entitlementCount + (vote.entitlementCount === 1 ? ' stemrecht' : ' stemrechten');
    document.getElementById('receiptTime').textContent = formatDateTime(vote.acceptedAt);
    showScreen(receiptScreen);
    document.getElementById('receiptTitle').tabIndex = -1;
    document.getElementById('receiptTitle').focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function schedulePoll() {
    stopPolling();
    pollTimer = window.setTimeout(function () { pollStatus(false); }, 4000 + Math.random() * 2000);
  }

  function stopPolling() {
    if (pollTimer !== null) window.clearTimeout(pollTimer);
    pollTimer = null;
  }

  function resetToLogin(message) {
    stopPolling();
    sessionToken = null;
    statusEtag = null;
    currentStatus = null;
    currentVote = null;
    pendingChoice = null;
    document.getElementById('meetingIdentity').hidden = true;
    showScreen(loginScreen);
    showNotice(loginError, message);
    accessCode.focus();
  }

  function authorizationHeaders() {
    return {
      Authorization: 'Bearer ' + sessionToken,
      'X-Device-Binding': deviceBinding
    };
  }

  async function readResponse(response) {
    var body = null;
    try { body = await response.json(); } catch (_error) { body = {}; }
    if (response.ok) return body;
    var error = new Error(body.message || body.error || 'request_failed');
    error.code = body.error;
    error.status = response.status;
    error.retryAfter = response.headers.get('Retry-After');
    throw error;
  }

  function loginErrorMessage(error) {
    if (error.code === 'AUTH_LOCKED') {
      return 'Deze code is tijdelijk vergrendeld. Probeer het over ' + retryText(error.retryAfter) + ' opnieuw.';
    }
    if (error.code === 'AUTH_RATE_LIMITED') {
      return 'Te veel inlogpogingen. Probeer het over ' + retryText(error.retryAfter) + ' opnieuw.';
    }
    if (error.code === 'AUTH_INVALID' || error.status === 401) {
      return 'De toegangscode is niet geldig. Controleer de code en probeer opnieuw.';
    }
    return 'Inloggen lukt nu niet. Controleer uw verbinding en probeer opnieuw.';
  }

  function retryText(seconds) {
    var amount = Number(seconds);
    return Number.isFinite(amount) && amount > 0 ? amount + ' seconden' : 'enkele ogenblikken';
  }

  function showScreen(active) {
    [loginScreen, roundScreen, receiptScreen].forEach(function (screen) {
      screen.hidden = screen !== active;
    });
  }

  function showNotice(element, message) { element.textContent = message; element.hidden = false; }
  function clearNotice(element) { element.textContent = ''; element.hidden = true; }
  function choiceLabel(choice) { return choice === 'voor' ? 'Voor' : 'Tegen'; }
  function splittingClass(code) {
    var value = String(code || '').toLowerCase();
    return ['tf', 'nb', 'pg'].includes(value) ? value : 'other';
  }
  function statusText(status) {
    if (status === 'open') return 'Stemronde is open';
    if (status === 'waiting') return 'Wachten op de volgende ronde';
    return 'Stemronde is gesloten';
  }
  function formatRemaining(seconds) {
    var value = Math.max(0, Number(seconds) || 0);
    var minutes = Math.floor(value / 60);
    var rest = value % 60;
    return minutes + ':' + String(rest).padStart(2, '0');
  }
  function formatDate(value) {
    if (!value) return '';
    return new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value + 'T00:00:00Z'));
  }
  function formatDateTime(value) {
    if (!value) return 'Reeds geregistreerd';
    return new Intl.DateTimeFormat('nl-NL', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value));
  }
  function createDeviceBinding() {
    var bytes = new Uint8Array(24);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, function (value) { return value.toString(16).padStart(2, '0'); }).join('');
  }
}());
