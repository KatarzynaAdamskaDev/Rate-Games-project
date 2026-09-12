const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const User = sequelize.define(
  'User',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    username: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    passwordHash: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    role: {
      type: DataTypes.STRING,
      defaultValue: 'user',
    },
    // Lista ID znajomych trzymana jako JSON w polu tekstowym (na razie,
    // bez osobnej tabeli relacyjnej - wystarczające przy obecnej skali).
    friends: {
      type: DataTypes.TEXT,
      defaultValue: '[]',
    },
    resetPasswordToken: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    resetPasswordExpires: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
  },
  {
    tableName: 'users',
    timestamps: true, // dodaje automatycznie createdAt / updatedAt
  }
);

module.exports = User;