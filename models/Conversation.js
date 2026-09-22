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
    // Rozmowy prywatne zwykle pozwalają odpowiadać obu stronom. Administrator może napisać do
    // kogokolwiek (bez wzajemnej obserwacji) i wyłączyć tu odpowiedź - wtedy tylko admin może pisać
    // w tej rozmowie (patrz routes/chat.js, sprawdzenie przy wysyłaniu wiadomości).
    canReply: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    tableName: 'conversations',
    timestamps: true,
  }
);

module.exports = Conversation;