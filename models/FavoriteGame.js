const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// Ulubione gry użytkownika (max 6). Tytuł i okładka są zapisane razem z wpisem,
// żeby profil nie wymagał zapytań do IGDB przy każdym wyświetleniu.
const FavoriteGame = sequelize.define(
  'FavoriteGame',
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
    gameId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    coverImage: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
  },
  {
    tableName: 'favorite_games',
    timestamps: true,
    indexes: [{ unique: true, fields: ['userId', 'gameId'] }],
  }
);

module.exports = FavoriteGame;
