const path = require('path');

/**
 * Gdzie na dysku trafiają pliki wgrywane przez użytkowników (awatary, okładki wpisów, biblioteka multimediów bloga,
 * okładki gier). Adresy w bazie (np. /images/blog/media/xyz.webp) się nie zmieniają - zmienia się tylko miejsce
 * plików na dysku.
 *
 * Domyślnie pliki leżą w public/images (wygodne lokalnie). Na serwerze wdrażanym paczką (np. Azure App Service)
 * katalog aplikacji jest podmieniany przy każdym wdrożeniu, więc ustaw UPLOADS_DIR na trwały katalog poza aplikacją
 * (w App Service: /home/uploads) - aplikacja poda go pod tym samym adresem /images/...
 */
const custom = process.env.UPLOADS_DIR ? path.resolve(process.env.UPLOADS_DIR) : null;
const root = custom || path.join(__dirname, '..', 'public', 'images');

module.exports = {
  /** Czy pliki leżą poza public/ (wtedy aplikacja musi je sama udostępnić pod /images). */
  isCustomRoot: !!custom,
  UPLOADS_ROOT: root,
  AVATAR_DIR: path.join(root, 'avatars'),
  BLOG_COVER_DIR: path.join(root, 'blog', 'uploads'),
  BLOG_MEDIA_DIR: path.join(root, 'blog', 'media'),
  GAME_COVER_DIR: path.join(root, 'games', 'uploads'),
  GROUP_PHOTO_DIR: path.join(root, 'chat', 'groups'),
};
