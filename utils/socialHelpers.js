const { v4: uuidv4 } = require('uuid');
const { readCollection, writeCollection } = require('./dataStore');

function isFollowing(followerId, followingId) {
  return readCollection('follows').some(
    (f) => f.followerId === followerId && f.followingId === followingId
  );
}

function follow(followerId, followingId) {
  if (followerId === followingId) return false;
  if (isFollowing(followerId, followingId)) return false;

  const follows = readCollection('follows');
  follows.push({
    id: uuidv4(),
    followerId,
    followingId,
    createdAt: new Date().toISOString(),
  });
  writeCollection('follows', follows);
  return true;
}

function unfollow(followerId, followingId) {
  const follows = readCollection('follows');
  const next = follows.filter(
    (f) => !(f.followerId === followerId && f.followingId === followingId)
  );
  writeCollection('follows', next);
  return next.length !== follows.length;
}

function getFollowers(userId) {
  return readCollection('follows').filter((f) => f.followingId === userId);
}

function getFollowing(userId) {
  return readCollection('follows').filter((f) => f.followerId === userId);
}

module.exports = { isFollowing, follow, unfollow, getFollowers, getFollowing };
