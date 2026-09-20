/**
 * Komentarze pod wpisami bloga (models/BlogComment.js).
 * Działają jak komentarze pod recenzjami: komentarze osób zablokowanych przez oglądającego są ukryte,
 * usuwać może autor komentarza albo administrator.
 */
const BlogComment = require('../models/BlogComment');
const { getBlockedIds } = require('./blockHelpers');

const MAX_COMMENT_LENGTH = 500;
const MAX_SHOWN = 300;

/** Komentarze wpisu od najstarszego; bez komentarzy osób zablokowanych przez `viewerId`. */
async function getCommentsForPost(postId, viewerId) {
  const [rows, blocked] = await Promise.all([
    BlogComment.findAll({ where: { postId }, order: [['createdAt', 'ASC']], limit: MAX_SHOWN }),
    getBlockedIds(viewerId),
  ]);
  const hidden = new Set(blocked);
  return rows.map((row) => row.get({ plain: true })).filter((comment) => !hidden.has(comment.userId));
}

function countCommentsForPosts(postIds) {
  if (!postIds.length) return Promise.resolve(new Map());
  const { fn, col } = require('sequelize');
  return BlogComment.findAll({
    attributes: ['postId', [fn('COUNT', col('id')), 'total']],
    where: { postId: postIds },
    group: ['postId'],
    raw: true,
  }).then((rows) => new Map(rows.map((row) => [row.postId, Number(row.total)])));
}

async function addComment({ postId, userId, username, text }) {
  const instance = await BlogComment.create({ postId, userId, username, text });
  return instance.get({ plain: true });
}

/** Usuwa komentarz, jeśli `user` jest jego autorem albo administratorem. @returns {Promise<object|null>} usunięty komentarz */
async function deleteComment(commentId, user) {
  const comment = await BlogComment.findByPk(commentId);
  if (!comment) return null;
  if (comment.userId !== user.id && user.role !== 'admin') return null;
  const plain = comment.get({ plain: true });
  await comment.destroy();
  return plain;
}

/** Usuwa wszystkie komentarze wpisu (przy usunięciu wpisu). */
function deleteCommentsForPost(postId) {
  return BlogComment.destroy({ where: { postId } });
}

module.exports = {
  MAX_COMMENT_LENGTH,
  getCommentsForPost,
  countCommentsForPosts,
  addComment,
  deleteComment,
  deleteCommentsForPost,
};
