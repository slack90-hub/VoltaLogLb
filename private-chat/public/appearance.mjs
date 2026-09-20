(() => {
  const storageKey='room-appearance';
  let neutral=false;
  try{neutral=localStorage.getItem(storageKey)==='neutral';}catch{}
  document.documentElement.dataset.appearance=neutral?'neutral':'personal';
  function apply(save=false){
    document.documentElement.dataset.appearance=neutral?'neutral':'personal';
    document.querySelectorAll('[data-personal-copy]').forEach(element=>{element.textContent=element.getAttribute(neutral?'data-neutral-copy':'data-personal-copy');});
    document.querySelectorAll('[data-personal-label]').forEach(element=>{element.setAttribute('aria-label',element.getAttribute(neutral?'data-neutral-label':'data-personal-label'));});
    const toggle=document.getElementById('neutral-mode');if(toggle)toggle.checked=neutral;
    if(save){try{localStorage.setItem(storageKey,neutral?'neutral':'personal');}catch{}}
    window.dispatchEvent(new Event('room-appearance-change'));
  }
  document.addEventListener('DOMContentLoaded',()=>{
    apply();
    document.getElementById('neutral-mode')?.addEventListener('change',event=>{neutral=event.target.checked;apply(true);});
  });
  window.addEventListener('storage',event=>{if(event.key===storageKey){neutral=event.newValue==='neutral';apply();}});
})();
