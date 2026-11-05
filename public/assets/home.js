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
      formatY: (v, digits, axis) => axis ? v.toFixed(digits) : `${v.toFixed(1)} cm`,
      label: `Line chart. Mean total length of European plaice in the North Sea was ${points[0][1].toFixed(1)} cm in ${points[0][0]} and ${points[points.length - 1][1].toFixed(1)} cm in ${points[points.length - 1][0]}.`,
    });
  } catch (e) {
    host.textContent = 'This figure could not be loaded.';
  }
})();
