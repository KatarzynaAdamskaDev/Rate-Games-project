const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// Wpisy bloga. Identyfikator jest tekstem (dawne wpisy mają id typu "b1", nowe - UUID), bo trafia do adresów
// /blog/:id i do komentarzy (blog_comments.postId). Stan wpisu (szkic / zaplanowany / opublikowany) liczymy przy
// odczycie z pól status i publishAt, a publishedAt to zapamiętana data, wg której układamy listę:
// publishAt (jeśli podano) albo createdAt. Tagi są w osobnej tabeli blog_post_tags.
const BlogPost = sequelize.define(
  'BlogPost',
  {
    id: {
      type: DataTypes.STRING(64),
      primaryKey: true,
    },
    title: {
      type: DataTypes.STRING(200),
      allowNull: false,
    },
    author: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'Redakcja GameVerse',
    },
    category: {
      type: DataTypes.STRING(40),
      allowNull: false,
      defaultValue: 'Aktualności',
    },
    excerpt: {
      type: DataTypes.STRING(500),
      allowNull: false,
      defaultValue: '',
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    readMinutes: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
    coverImage: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    // Okładka tworzona automatycznie: parametry (JSON w tekście) i numer wariantu.
    coverAuto: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    coverSpec: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    coverVariant: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    status: {
      type: DataTypes.STRING(12),
      allowNull: false,
      defaultValue: 'published',
    },
    publishAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    publishedAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: 'blog_posts',
    // Daty ustawia aplikacja (wpis zachowuje datę utworzenia, a "edytowano" tylko po edycji).
    timestamps: false,
    indexes: [{ fields: ['status', 'publishedAt'] }],
  }
);

module.exports = BlogPost;
