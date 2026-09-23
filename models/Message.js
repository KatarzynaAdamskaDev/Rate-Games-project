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
  },
  {
    tableName: 'messages',
    timestamps: true,
  }
);

module.exports = Message;