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
    avatarUrl: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    bio: {
      type: DataTypes.STRING(300),
      allowNull: true,
    },
    activeFrame: {
      type: DataTypes.STRING,
      defaultValue: 'frame-basic',
    },
    activeBackground: {
      type: DataTypes.STRING,
      defaultValue: 'bg-default',
    },
    // Odznaka wyświetlana jako trofeum w banerze profilu (id odznaki; null = domyślne).
    activeTrophy: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    // Administrator odblokował temu użytkownikowi wszystkie ramki, tła i odznaki.
    unlockAll: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    // Ustawienia powiadomień jako JSON (tylko odstępstwa od domyślnych - patrz utils/notificationPrefs.js).
    notificationPrefs: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    // Dwuetapowe logowanie (TOTP) - dostępne dla administratorów.
    twoFactorEnabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    twoFactorSecret: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    // JSON z hashami (SHA-256) jednorazowych kodów awaryjnych.
    twoFactorRecovery: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    // Blokada konta przez administratora (panel /admin).
    isBanned: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    banReason: {
      type: DataTypes.STRING(200),
      allowNull: true,
    },
    // Punkty doświadczenia (PD) i poziom - przechowywane w bazie, a
    // aktualizowane przy każdej zmianie aktywności (utils/progressHelpers.js).
    points: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    level: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
    // PD przyznane/odjęte ręcznie (np. skryptem set-level.js do testów) -
    // dodawane do PD z aktywności. Domyślnie 0.
    bonusPoints: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
  },
  {
    tableName: 'users',
    timestamps: true, // dodaje automatycznie createdAt / updatedAt
  }
);

module.exports = User;