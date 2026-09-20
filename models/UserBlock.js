const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// Użytkownik (blockerId) zablokował innego użytkownika (blockedId): ukrywa jego komentarze,
// a tamta osoba nie napisze do niego na czacie ani go nie zaobserwuje (utils/blockHelpers.js).
const UserBlock = sequelize.define(
  'UserBlock',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    blockerId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    blockedId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
  },
  {
    tableName: 'user_blocks',
    timestamps: true,
    indexes: [{ unique: true, fields: ['blockerId', 'blockedId'] }],
  }
);

module.exports = UserBlock;
