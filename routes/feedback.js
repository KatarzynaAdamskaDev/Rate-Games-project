const express = require('express');
const router = express.Router();

const { ensureAuthenticated } = require('../middleware/auth');
const { submitFeedback } = require('../utils/feedbackHelpers');

// Krótka ankieta "Dołącz do społeczności" na stronie głównej (zob. views/index.ejs).
// Limit zapisu POST-ów jest już globalny (app.js, limiters.writes) - nie trzeba go tu powtarzać.
router.post('/', ensureAuthenticated, async (req, res, next) => {
  try {
    const rating = Number(req.body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      req.flash('error', 'Wybierz ocenę od 1 do 5.');
      return res.redirect('/');
    }

    await submitFeedback({
      userId: req.session.user.id,
      username: req.session.user.username,
      rating,
      comment: String(req.body.comment || '').trim().slice(0, 500),
    });

    req.flash('success', 'Dziękujemy za opinię!');
    res.redirect('/');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
