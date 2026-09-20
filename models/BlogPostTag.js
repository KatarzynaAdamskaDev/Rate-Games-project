const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// Tagi wpisów bloga: jeden wiersz na tag. tagKey to nazwa małymi literami (do porównań i filtrowania),
// tag - napis w oryginalnej pisowni, position - kolejność tagów we wpisie.
const BlogPostTag = sequelize.define(
  'BlogPostTag',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    postId: {
      type: DataTypes.STRING(64),
      allowNull: false,
      references: { model: 'blog_posts', key: 'id' },
      onDelete: 'CASCADE',
    },
    tag: {
      type: DataTypes.STRING(48),
      allowNull: false,
    },
    tagKey: {
      type: DataTypes.STRING(48),
      allowNull: false,
    },
    position: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
  },
  {
    tableName: 'blog_post_tags',
    timestamps: false,
    indexes: [{ fields: ['postId'] }, { fields: ['tagKey'] }],
  }
);

module.exports = BlogPostTag;
