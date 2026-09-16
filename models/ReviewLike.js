const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const ReviewLike = sequelize.define(
  'ReviewLike',
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
  },
  {
    tableName: 'review_likes',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['reviewId', 'userId'],
      },
    ],
  }
);

module.exports = ReviewLike;