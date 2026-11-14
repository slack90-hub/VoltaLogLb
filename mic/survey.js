(() => {
  const form = document.getElementById('interest-form');
  const status = document.getElementById('survey-status');
  const button = form.querySelector('button[type="submit"]');
  let sending = false;
  const picker = document.getElementById('insurance-picker');
  const choices = picker ? [...picker.querySelectorAll('input[type="checkbox"]')] : [];
  const selectionText = document.getElementById('insurance-selection');
  const selectedTypes = () => choices.filter(choice => choice.checked).map(choice => choice.value);
  const updateSelection = () => {
    if (selectionText) selectionText.textContent = selectedTypes().join(', ') || 'Select insurance types';
  };
  choices.forEach(choice => choice.addEventListener('change', updateSelection));
  picker?.addEventListener('keydown', event => {
    if (event.key === 'Escape') { picker.open = false; picker.querySelector('summary').focus(); }
  });
  document.addEventListener('click', event => {
    if (picker && !picker.contains(event.target)) picker.open = false;
  });
  updateSelection();

  // Keep visitors on the page; personal details only travel in the HTTPS body.
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (sending || !form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form));
    if (picker) {
      const selected = selectedTypes();
      if (!selected.length) {
        status.dataset.state = 'error';
        status.textContent = 'Please select at least one insurance type.';
        picker.open = true;
        choices[0].focus();
        return;
      }
      const message = String(data.interest || '').trim();
      data.interest = 'Interest in: ' + selected.join(', ') + (message ? '\n\nMessage: ' + message : '');
      delete data.insuranceTypes;
    }
    for (const key of ['name', 'phone', 'email', 'interest']) {
      if (!data[key].trim()) {
        status.textContent = 'Please complete your contact details and interest.';
        form.elements[key].focus();
        return;
      }
    }
    sending = true;
    button.disabled = true;
    button.textContent = 'Sending…';
    form.setAttribute('aria-busy', 'true');
    status.dataset.state = 'pending';
    status.textContent = 'Sending your enquiry…';
    try {
      const response = await fetch('https://mic-survey.slack-90.workers.dev/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(25000),
        credentials: 'omit',
        referrerPolicy: 'no-referrer'
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true) {
        throw new Error(result.error || 'Your enquiry could not be sent. Please try again.');
      }
      form.reset();
      updateSelection();
      if (picker) picker.open = false;
      status.dataset.state = 'success';
      status.textContent = 'Thank you! Your enquiry has been sent. The MIC team will be in touch.';
    } catch (error) {
      status.dataset.state = 'error';
      status.textContent = error.name === 'TimeoutError' || error instanceof TypeError
        ? 'We couldn’t confirm delivery. Your details are still here. Please try again, or email mic@mdslb.com.'
        : error.message;
    } finally {
      sending = false;
      button.disabled = false;
      button.textContent = 'Send my enquiry ↗';
      form.removeAttribute('aria-busy');
    }
  });
})();
