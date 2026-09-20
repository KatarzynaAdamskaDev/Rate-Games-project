const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Notification = sequelize.define(
  'Notification',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    // Odbiorca powiadomienia
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    // 'follow' | 'review-like' | 'review-comment' | 'blog-comment' | 'comment-like'
    type: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    actorId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    message: {
      type: DataTypes.STRING(300),
      allowNull: false,
    },
    link: {
      type: DataTypes.STRING(300),
      allowNull: true,
    },
    isRead: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  },
  {
    tableName: 'notifications',
    timestamps: true,
    indexes: [{ fields: ['userId', 'isRead'] }],
  }
);

module.exports = Notification;
