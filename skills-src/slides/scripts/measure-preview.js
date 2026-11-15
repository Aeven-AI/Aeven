async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const luminance = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const hex = (r, g, b) => '#' + [r, g, b].map(v => Math.min(255, v).toString(16).padStart(2, '0')).join('').toUpperCase();
  const saturation = ([r, g, b]) => (Math.max(r, g, b) - Math.min(r, g, b)) / 255;

  const urls = [...new Set([...document.querySelectorAll('img')]
    .filter(img => img.naturalWidth >= 600 && (img.currentSrc || img.src || '').includes('/carousel/img/'))
    .map(img => img.currentSrc || img.src))].slice(0, 20);

  if (urls.length === 0) {
    return { error: 'no loaded slide images yet', title: document.title };
  }

  const counts = new Map();
  const bandHeights = [];
  const margins = [];
  const coverage = [];
  let total = 0;
  let measured = 0;

  for (const url of urls) {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    const ok = await new Promise((resolve) => {
      image.onload = () => resolve(true);
      image.onerror = () => resolve(false);
      image.src = url;
      setTimeout(() => resolve(false), 8000);
    });
    if (!ok) continue;
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = Math.round(320 * image.naturalHeight / image.naturalWidth);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let data;
    try {
      ({ data } = context.getImageData(0, 0, canvas.width, canvas.height));
    } catch (error) {
      continue;
    }
    const { width, height } = canvas;
    const local = new Map();
    for (let i = 0; i < data.length; i += 4) {
      const key = [data[i], data[i + 1], data[i + 2]].map(v => Math.min(240, Math.round(v / 16) * 16)).join(',');
      local.set(key, (local.get(key) ?? 0) + 1);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      total += 1;
    }
    let pageShare = 0;
    for (const count of local.values()) pageShare = Math.max(pageShare, count);
    coverage.push(pageShare / (width * height));

    let start = -1;
    for (let y = 0; y < height; y += 1) {
      let low = 1, high = 0, leftMost = width;
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        const value = luminance(data[index], data[index + 1], data[index + 2]);
        low = Math.min(low, value);
        high = Math.max(high, value);
        if (value > 0.55) leftMost = Math.min(leftMost, x);
      }
      if (high - low > 0.16 && start < 0) start = y;
      if (high - low <= 0.16 && start >= 0) {
        if (y - start > 1) {
          bandHeights.push((y - start) * (1280 / width));
          margins.push(leftMost * (1280 / width));
        }
        start = -1;
      }
    }
    measured += 1;
  }

  if (total === 0) return { error: 'images could not be read', urls: urls.length, title: document.title };

  const ranked = [...counts.entries()].map(([key, count]) => {
    const [r, g, b] = key.split(',').map(Number);
    return { rgb: [r, g, b], share: count / total };
  }).sort((a, b) => b.share - a.share);

  const page = ranked[0];
  const pageLum = luminance(...page.rgb);
  const dark = pageLum < 0.35;
  const accentEntry = ranked.filter(i => saturation(i.rgb) > 0.18 && i.share > 0.003).sort((a, b) => saturation(b.rgb) - saturation(a.rgb))[0] ?? ranked[1] ?? page;
  const inkPool = dark ? ranked.filter(i => luminance(...i.rgb) > 0.7) : ranked.filter(i => luminance(...i.rgb) < 0.25);
  const inkEntry = inkPool.sort((a, b) => b.share - a.share)[0] ?? (dark ? { rgb: [250, 250, 250] } : { rgb: [24, 24, 24] });
  const mutedPool = ranked.filter(i => { const l = luminance(...i.rgb); return l > 0.3 && l < 0.78 && saturation(i.rgb) < 0.22; });
  const mutedEntry = mutedPool.sort((a, b) => b.share - a.share)[0] ?? inkEntry;

  bandHeights.sort((a, b) => a - b);
  margins.sort((a, b) => a - b);
  coverage.sort((a, b) => a - b);
  const clamp = (v, low, high) => Math.min(Math.max(Math.round(v), low), high);
  const titlePx = bandHeights.length ? bandHeights[Math.floor(bandHeights.length * 0.95)] : 60;
  const bodyPx = bandHeights.length > 6 ? bandHeights[Math.floor(bandHeights.length / 6)] : 14;
  const preset = dark ? 'contrast' : (pageLum > 0.72 && saturation(page.rgb) > 0.08 ? 'pastel' : 'paper');

  return {
    title: document.title.replace(/\s*\|\s*Figma\s*$/, ''),
    measured,
    urls: urls.length,
    preset,
    palette: ranked.slice(0, 6).map(i => [hex(...i.rgb), +(i.share * 100).toFixed(1)]),
    page: hex(...page.rgb),
    accent: hex(...accentEntry.rgb),
    ink: hex(...inkEntry.rgb),
    muted: hex(...mutedEntry.rgb),
    coverage: +(coverage[Math.floor(coverage.length / 2)] * 100).toFixed(0),
    margin: clamp(margins[Math.floor(margins.length / 2)] ?? 64, 40, 96),
    type: {
      title: clamp(titlePx / 0.72, 44, 84),
      titleContent: clamp(titlePx / 0.72 * 0.8, 36, 68),
      titleCover: clamp(titlePx / 0.72 * 1.3, 56, 96),
      lead: clamp(bodyPx * 2, 18, 32),
      body: clamp(bodyPx * 0.95, 12, 17),
      caption: clamp(bodyPx * 0.9, 11, 16),
    },
  };
}
