const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// Gry dodane ręcznie przez administratora (pozostałe gry pochodzą z IGDB).
const CustomGame = sequelize.define(
  'CustomGame',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    category: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    platform: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'PC',
    },
    releaseYear: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    coverImage: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
  },
  {
    tableName: 'custom_games',
    timestamps: true,
  }
);

module.exports = CustomGame;
