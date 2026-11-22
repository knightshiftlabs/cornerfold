// Applies the saved look before the first paint, so the page never flashes the wrong theme.
// It is the same rule as apply() in src/lib/prefs.ts; tests/prefs.test.ts keeps the two in step.
(function () {
  var C = {
    theme: ['auto', 'light', 'dark', 'midnight', 'paper'],
    accent: ['indigo', 'blue', 'violet', 'pink', 'orange', 'green', 'graphite'],
    desk: ['graphite', 'slate', 'linen', 'felt'],
    paper: ['bright', 'soft', 'warm'],
    shadow: ['flat', 'soft', 'lifted'],
    select: ['fold', 'check', 'ring'],
    corners: ['sharp', 'soft', 'round'],
    density: ['compact', 'calm', 'airy'],
    motion: ['full', 'calm', 'off'],
    text: ['default', 'large', 'largest'],
  }
  var D = { theme: 'auto', accent: 'indigo', desk: 'graphite', paper: 'soft', shadow: 'soft', select: 'fold', corners: 'soft', density: 'calm', motion: 'full', text: 'default', glass: 70, size: 37 }
  var DESK = { light: '#e7e8ee', dark: '#0c0d11', midnight: '#000000', paper: '#efe9dc' }
  var saved = {}
  try {
    saved = JSON.parse(localStorage.getItem('cornerfold.look')) || {}
  } catch (e) {}
  if (typeof saved !== 'object') saved = {}
  var pick = function (k) {
    return C[k].indexOf(saved[k]) >= 0 ? saved[k] : D[k]
  }
  var num = function (k) {
    var v = saved[k]
    return typeof v === 'number' && isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : D[k]
  }
  var root = document.documentElement
  var theme = pick('theme')
  if (theme === 'auto') theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  root.dataset.theme = theme
  root.dataset.accent = pick('accent')
  root.dataset.desk = pick('desk')
  root.dataset.paper = pick('paper')
  root.dataset.shadow = pick('shadow')
  root.dataset.sel = pick('select')
  root.dataset.corners = pick('corners')
  root.dataset.density = pick('density')
  root.dataset.motion = pick('motion')
  root.dataset.text = pick('text')
  if (saved.contrast === true) root.dataset.contrast = 'high'
  root.style.setProperty('--glass', String(num('glass')))
  root.style.setProperty('--size', String(num('size')))
  var metas = document.querySelectorAll('meta[name="theme-color"]')
  for (var i = 0; i < metas.length; i++) {
    metas[i].removeAttribute('media')
    metas[i].content = DESK[theme]
  }
})()
