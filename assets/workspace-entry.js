(() => {
  // A discreet entrance, not an authentication boundary. The room requires both
  // an individual account and a separately shared encryption recovery key.
  const destination = 'https://mds-room.slack-90.workers.dev/';
  const entry = document.querySelector('.mds-footer-bottom > span');
  if (!entry) return;
  let taps = 0, previous = 0;
  const activate = () => {
    const now = Date.now(); taps = now - previous < 2500 ? taps + 1 : 1; previous = now;
    if (taps >= 5) { taps = 0; location.assign(destination); }
  };
  entry.addEventListener('click', activate);
  document.addEventListener('keydown', event => {
    if (event.altKey && event.shiftKey && event.code === 'KeyM') { event.preventDefault(); location.assign(destination); }
  });
})();
