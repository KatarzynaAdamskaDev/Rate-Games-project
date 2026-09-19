/**
 * Opis w banerze profilu ma stałą wysokość: gdy tekst jest dłuższy, jest ucinany,
 * a przycisk "Zobacz więcej" otwiera okno z całym opisem (views/profile/show.ejs).
 */
(function () {
  var bio = document.getElementById('profileBio');
  var more = document.getElementById('profileBioMore');
  if (!bio || !more) return;

  function update() {
    // Tekst ucięty przez line-clamp jest wyższy niż widoczne pole.
    more.classList.toggle('d-none', bio.scrollHeight <= bio.clientHeight + 1);
  }

  update();
  window.addEventListener('resize', update);
  // Czcionki ładują się po pierwszym wyrenderowaniu i zmieniają zawijanie linii.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(update);
})();
