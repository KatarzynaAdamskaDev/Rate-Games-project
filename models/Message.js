const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Message = sequelize.define(
  'Message',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    conversationId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    senderId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    senderUsername: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    text: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    // 'text' (zwykła wiadomość, może zawierać emoji - to zwykłe znaki Unicode) albo 'gif'
    // (wtedy text to zweryfikowany adres obrazka na CDN Giphy - zob. utils/giphy.js).
    kind: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'text',
    },
    // Kiedy autor ostatnio poprawił treść (puste = wiadomość nigdy nie była edytowana).
    editedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    // Usunięcie przez autora to "miękkie" usunięcie: wiersz zostaje (odpowiedzi na tę wiadomość
    // dalej mają do czego się odwoływać), ale treść jest czyszczona i klienci pokazują tylko
    // informację, że wiadomość została usunięta.
    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    // Wiadomość, na którą ta jest odpowiedzią (styl Messengera). Zawsze z tej samej rozmowy.
    replyToId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
  },
  {
    tableName: 'messages',
    timestamps: true,
    indexes: [{ fields: ['conversationId', 'updatedAt'] }],
  }
);

module.exports = Message;