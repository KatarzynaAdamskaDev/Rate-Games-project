/**
 * Ulubione gry użytkownika - maksymalnie MAX_FAVORITES pozycji (siatka 3 x 2).
 */
const FavoriteGame = require('../models/FavoriteGame');
const { getGameById } = require('./gameCatalog');

const MAX_FAVORITES = 6;

async function getFavorites(userId) {
  const rows = await FavoriteGame.findAll({ where: { userId } });
  return rows
    .map((r) => r.get({ plain: true }))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

/** @returns {{ ok: boolean, reason?: 'limit' | 'duplicate' | 'not_found' }} */
async function addFavorite(userId, gameId) {
  const current = await getFavorites(userId);
  if (current.length >= MAX_FAVORITES) return { ok: false, reason: 'limit' };
  if (current.some((f) => f.gameId === String(gameId))) return { ok: false, reason: 'duplicate' };

  const game = await getGameById(gameId);
  if (!game) return { ok: false, reason: 'not_found' };

  await FavoriteGame.create({
    userId,
    gameId: String(game.id),
    title: game.title,
    coverImage: game.coverImage,
  });
  return { ok: true, title: game.title };
}

async function removeFavorite(userId, gameId) {
  const count = await FavoriteGame.destroy({ where: { userId, gameId: String(gameId) } });
  return count > 0;
}

module.exports = { MAX_FAVORITES, getFavorites, addFavorite, removeFavorite };
