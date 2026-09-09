const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

const { ensureAuthenticated, ensureAdmin } = require('../middleware/auth');
const { readCollection, writeCollection } = require('../utils/dataStore');

router.get('/', (req, res) => {
  const posts = readCollection('blog').sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
  res.render('blog/list', { title: 'Blog', posts });
});

router.get('/new', ensureAuthenticated, ensureAdmin, (req, res) => {
  res.render('blog/form', { title: 'Nowy wpis na blogu', formData: {} });
});

router.post('/new', ensureAuthenticated, ensureAdmin, (req, res) => {
  const { title, excerpt, content, coverImage } = req.body;

  if (!title || !content) {
    req.flash('error', 'Tytuł i treść wpisu są wymagane.');
    return res
      .status(400)
      .render('blog/form', { title: 'Nowy wpis na blogu', formData: req.body });
  }

  const posts = readCollection('blog');
  const newPost = {
    id: uuidv4(),
    title,
    author: req.session.user.username,
    excerpt: excerpt || content.slice(0, 140),
    content,
    coverImage: coverImage || '/images/game-placeholder.svg',
    createdAt: new Date().toISOString(),
  };
  posts.push(newPost);
  writeCollection('blog', posts);

  req.flash('success', 'Wpis został opublikowany.');
  res.redirect(`/blog/${newPost.id}`);
});

router.get('/:id', (req, res, next) => {
  const post = readCollection('blog').find((p) => p.id === req.params.id);
  if (!post) return next();
  res.render('blog/detail', { title: post.title, post });
});

module.exports = router;
