const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// Kiedy dany użytkownik ostatnio odczytał daną rozmowę (do licznika nieprzeczytanych).
const ConversationRead = sequelize.define(
  'ConversationRead',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    conversationId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    lastReadAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
  },
  {
    tableName: 'conversation_reads',
    timestamps: false,
    indexes: [{ unique: true, fields: ['userId', 'conversationId'] }],
  }
);

module.exports = ConversationRead;
