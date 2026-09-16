const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const ReviewComment = sequelize.define(
  'ReviewComment',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    reviewId: {
      type: DataTypes.UUID,
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
    tableName: 'review_comments',
    timestamps: true,
  }
);

module.exports = ReviewComment;