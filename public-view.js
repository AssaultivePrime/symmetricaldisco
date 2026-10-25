// Scales the fixed-width page design to the visitor's screen (shrinks on phones, optionally grows on wide screens).
(function () {
  var s = document.getElementById('scaler');
  if (!s) return;
  var w = +s.getAttribute('data-w'), h = +s.getAttribute('data-h'), wide = s.getAttribute('data-wide');
  function fit() {
    var vw = document.documentElement.clientWidth;
    var k = vw < w || wide === 'fit' ? vw / w : 1;
    s.style.width = w + 'px';
    s.style.transform = 'scale(' + k + ')';
    s.style.marginLeft = Math.max(0, (vw - w * k) / 2) + 'px';
    s.style.marginRight = '0';
    document.body.style.height = Math.ceil(h * k) + 'px';
  }
  fit();
  window.addEventListener('resize', fit);
})();
