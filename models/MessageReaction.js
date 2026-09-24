const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// Reakcja na wiadomość czatu. Jak w Messengerze: jedna osoba ma na wiadomości co najwyżej jedną
// reakcję (kolejne kliknięcie innej ją zmienia, kliknięcie tej samej zdejmuje).
// Klucze reakcji są zdefiniowane w utils/chatHelpers.js (REACTIONS) - w bazie trzymamy sam klucz.
const MessageReaction = sequelize.define(
  'MessageReaction',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    messageId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    // Rozmowa trzymana obok, żeby usunięcie/wyczyszczenie rozmowy nie wymagało odczytu wiadomości.
    conversationId: {
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
    key: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
  },
  {
    tableName: 'message_reactions',
    timestamps: true,
    indexes: [
      { unique: true, fields: ['messageId', 'userId'] },
      { fields: ['conversationId'] },
    ],
  }
);

module.exports = MessageReaction;
