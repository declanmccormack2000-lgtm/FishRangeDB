/* Figure 1 on the front page: plaice in one survey, quarter and gear. */
'use strict';
(async function () {
  const host = document.getElementById('figure-1');
  try {
    const rec = await FRD.json(FRD.speciesFile('Pleuronectes platessa'));
    const d = rec.len.find(x => x.src === 'ICES' && x.title === 'NS-IBTS, quarter 1, gear GOV' && x.type === 'TL');
    const points = d.rows.filter(r => r[0] >= 1980).map(r => [r[0], r[2]]);
    FRD.lineChart(host, {
      points,
      formatY: (v, digits, axis) => axis ? v.toFixed(digits) : FRD.t('cm', { v: v.toFixed(1) }),
      label: FRD.t('fig_aria', { a: points[0][1].toFixed(1), ya: points[0][0], b: points[points.length - 1][1].toFixed(1), yb: points[points.length - 1][0] }),
    });
  } catch (e) {
    host.textContent = FRD.t('fig_failed');
  }
})();
