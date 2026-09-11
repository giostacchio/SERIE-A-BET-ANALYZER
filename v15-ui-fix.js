(() => {
  'use strict';
  function fixLabels() {
    const lab = document.getElementById('v15ConsensusLab');
    if (!lab) return;
    lab.querySelectorAll('.v15-metrics b').forEach((node) => {
      const text = node.textContent || '';
      const match = text.match(/^undefined\/(\d+)$/);
      if (match) node.textContent = match[1] + ' test';
    });
  }
  window.addEventListener('load', () => window.setTimeout(fixLabels, 300));
  const observer = new MutationObserver(() => fixLabels());
  window.addEventListener('load', () => {
    const target = document.getElementById('generatedBox');
    if (target && target.parentElement) observer.observe(target.parentElement, { childList: true, subtree: true, characterData: true });
  });
})();
