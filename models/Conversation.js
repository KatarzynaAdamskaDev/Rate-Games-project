const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Conversation = sequelize.define(
  'Conversation',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    type: {
      type: DataTypes.STRING, // 'dm' | 'group' | 'game-room'
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    ownerId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    gameId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    // Lista uczestników jako JSON w polu tekstowym (ten sam wzorzec co
    // pole "friends" w modelu User) - prostsze niż osobna tabela łącząca.
    memberIds: {
      type: DataTypes.TEXT,
      defaultValue: '[]',
    },
    memberNames: {
      type: DataTypes.TEXT,
      defaultValue: '{}',
    },
    lastMessageAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: 'conversations',
    timestamps: true,
  }
);

module.exports = Conversation;