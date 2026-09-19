const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// Sesje użytkowników przechowywane w bazie (utils/sessionStore.js), dzięki czemu
// przeżywają restart serwera i działają przy kilku instancjach aplikacji.
const Session = sequelize.define(
  'Session',
  {
    sid: {
      type: DataTypes.STRING(128),
      primaryKey: true,
    },
    data: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    expires: {
      type: DataTypes.DATE,
      allowNull: false,
    },
  },
  {
    tableName: 'sessions',
    timestamps: false,
    indexes: [{ fields: ['expires'] }],
  }
);

module.exports = Session;
