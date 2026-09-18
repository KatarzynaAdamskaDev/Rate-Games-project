const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const CommentLike = sequelize.define(
  'CommentLike',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    commentId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
  },
  {
    tableName: 'comment_likes',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['commentId', 'userId'],
      },
    ],
  }
);

module.exports = CommentLike;