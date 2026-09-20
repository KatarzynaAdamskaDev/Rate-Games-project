/**
 * Zgłaszanie komentarzy, użytkowników i wiadomości czatu (recenzje zgłasza się w routes/games.js).
 * Zgłoszenia trafiają do jednej kolejki w panelu admina (Zgłoszenia).
 */
const express = require('express');
const router = express.Router();

const { ensureAuthenticated } = require('../middleware/auth');
const { limiters } = require('../middleware/rateLimit');
const ContentReport = require('../models/ContentReport');
const ReviewComment = require('../models/ReviewComment');
const Review = require('../models/Review');
const Message = require('../models/Message');
const User = require('../models/User');
const { canAccessConversation } = require('../utils/chatHelpers');
const { findReason, MAX_COMMENT_LENGTH } = require('../utils/reportReasons');

router.use(ensureAuthenticated);

function backPath(req, fallback = '/') {
  try {
    const url = new URL(req.get('Referer') || '', `http://${req.get('host')}`);
    if (url.host === req.get('host')) return url.pathname + url.search + url.hash;
  } catch (err) {
    // niepoprawny nagłówek Referer
  }
  return fallback;
}

/**
 * Wspólna część: walidacja powodu i zapis zgłoszenia.
 * @param {object} target { type, id, userId, username, snapshot, link }
 */
async function submitReport(req, res, target) {
  const back = backPath(req);
  const reason = findReason(req.body.reason, target.type);
  if (!reason) {
    req.flash('error', 'Wybierz powód zgłoszenia.');
    return res.redirect(back);
  }

  const comment = String(req.body.comment || '').trim().slice(0, MAX_COMMENT_LENGTH);
  if (reason.id === 'other' && comment.length < 5) {
    req.flash('error', 'Przy powodzie "Inny" opisz krótko, o co chodzi.');
    return res.redirect(back);
  }

  if (target.userId && target.userId === req.session.user.id) {
    req.flash('error', 'Nie możesz zgłosić samego siebie ani własnej treści.');
    return res.redirect(back);
  }

  const existing = await ContentReport.findOne({
    where: { targetType: target.type, targetId: String(target.id), reporterId: req.session.user.id, status: 'pending' },
  });
  if (existing) {
    req.flash('success', 'Ta treść jest już zgłoszona - moderatorzy się nią zajmą.');
    return res.redirect(back);
  }

  await ContentReport.create({
    targetType: target.type,
    targetId: String(target.id),
    targetUserId: target.userId || null,
    targetUsername: target.username || null,
    snapshot: target.snapshot ? String(target.snapshot).slice(0, 600) : null,
    link: target.link || null,
    reporterId: req.session.user.id,
    category: reason.id,
    reason: reason.label,
    comment: comment || null,
  });

  req.flash('success', 'Dziękujemy za zgłoszenie. Trafiło do weryfikacji przez administratorów.');
  return res.redirect(back);
}

router.post('/comment/:commentId', limiters.report, async (req, res, next) => {
  try {
    const comment = await ReviewComment.findByPk(req.params.commentId);
    if (!comment) {
      req.flash('error', 'Ten komentarz już nie istnieje.');
      return res.redirect(backPath(req));
    }
    const review = await Review.findByPk(comment.reviewId);
    await submitReport(req, res, {
      type: 'comment',
      id: comment.id,
      userId: comment.userId,
      username: comment.username,
      snapshot: comment.text,
      link: review ? `/games/${review.gameId}#review-${review.id}` : null,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/user/:username', limiters.report, async (req, res, next) => {
  try {
    const user = await User.findOne({ where: { username: req.params.username } });
    if (!user) {
      req.flash('error', 'Nie znaleziono użytkownika.');
      return res.redirect(backPath(req));
    }
    await submitReport(req, res, {
      type: 'user',
      id: user.id,
      userId: user.id,
      username: user.username,
      snapshot: user.bio || null,
      link: `/${encodeURIComponent(user.username)}`,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/message/:messageId', limiters.report, async (req, res, next) => {
  try {
    const message = await Message.findByPk(req.params.messageId);
    // Zgłosić można tylko wiadomość z rozmowy, w której się uczestniczy.
    if (!message || !(await canAccessConversation(req.session.user.id, message.conversationId))) {
      req.flash('error', 'Nie znaleziono tej wiadomości.');
      return res.redirect(backPath(req));
    }
    await submitReport(req, res, {
      type: 'message',
      id: message.id,
      userId: message.senderId,
      username: message.senderUsername,
      snapshot: message.text,
      link: null,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
