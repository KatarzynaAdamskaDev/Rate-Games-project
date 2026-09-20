const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// Komentarze pod wpisami bloga. Wpisy trzymamy w pliku data/blog.json, więc postId to zwykły
// identyfikator (bez klucza obcego). Moderacja jest ta sama co przy komentarzach pod recenzjami:
// wyciszenie, limity, filtr wulgaryzmów, zgłoszenia i usuwanie przez administratora.
const BlogComment = sequelize.define(
  'BlogComment',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    postId: {
      type: DataTypes.STRING(64),
      allowNull: false,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    username: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    text: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
  },
  {
    tableName: 'blog_comments',
    timestamps: true,
    indexes: [{ fields: ['postId'] }],
  }
);

module.exports = BlogComment;
