const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const BacklogEntry = sequelize.define(
  'BacklogEntry',
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
    status: {
      type: DataTypes.STRING,
      allowNull: false,
    },
  },
  {
    tableName: 'backlog_entries',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['userId', 'gameId'],
      },
    ],
  }
);

module.exports = BacklogEntry;