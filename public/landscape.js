// The landscape page's script (public/landscape.html): the layout there is plain CSS, so this only keeps the frame's size exact where the browser's bars move, and
// listens to the game in the frame. The game says it is up ("ready", which on a phone can take a while: it is a big game); if it hasn't after 25 seconds (a frame this
// page isn't allowed), a note says so and links back, and it goes again if the game does turn up. The game asks to leave with "exit".
(function () {
  var frame = document.getElementById('game');
  var note = document.getElementById('note');
  var KEY = 'mazeHeist.landscape';
  function fit() {
    var w = window.innerWidth;
    var h = window.innerHeight;
    if (w >= h) {
      frame.style.width = w + 'px';
      frame.style.height = h + 'px';
      frame.style.transform = 'none';
    } else {
      // A frame h wide and w tall, turned a quarter clockwise about its top left, then slid back onto the screen.
      frame.style.width = h + 'px';
      frame.style.height = w + 'px';
      frame.style.transform = 'translateX(' + w + 'px) rotate(90deg)';
    }
  }
  fit();
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', fit);
  var up = false;
  window.addEventListener('message', function (e) {
    // Only the game in the frame sends these, so the sender isn't checked: a check that goes wrong would leave the note up over a game that is running.
    if (!e.data) return;
    if (e.data.maze === 'ready') {
      up = true;
      note.hidden = true; // it was only slow (a big game on a phone): the note, if it came up, goes
    }
    if (e.data.maze === 'exit') {
      try {
        window.sessionStorage.removeItem(KEY);
      } catch (err) {
        /* no storage: the game page won't send you back here */
      }
      window.location.replace('game.html');
    }
  });
  // The game's own page is proof enough too: same origin, so the page can look in, in case its message never got through.
  window.setInterval(function () {
    if (up) return;
    try {
      var doc = frame.contentDocument;
      if (doc && doc.getElementById('hud-top') && doc.getElementById('bg')) {
        up = true;
        note.hidden = true;
      }
    } catch (err) {
      /* not ours to look into: the message will have to do */
    }
  }, 1000);
  window.setTimeout(function () {
    if (!up) note.hidden = false;
  }, 25000);
})();
