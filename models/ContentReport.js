const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// Zgłoszenia komentarzy, użytkowników i wiadomości czatu (recenzje mają własną tabelę
// review_reports). Trafiają do tej samej kolejki w panelu admina (Zgłoszenia).
// Treść zgłoszonego elementu zapisujemy jako migawkę, bo autor może ją usunąć lub zmienić.
const ContentReport = sequelize.define(
  'ContentReport',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    // comment | user | message
    targetType: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    // Id komentarza, użytkownika albo wiadomości.
    targetId: {
      type: DataTypes.STRING(64),
      allowNull: false,
    },
    // Autor zgłoszonej treści (albo zgłoszony użytkownik).
    targetUserId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    targetUsername: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    snapshot: {
      type: DataTypes.STRING(600),
      allowNull: true,
    },
    // Adres, pod którym administrator zobaczy treść w kontekście.
    link: {
      type: DataTypes.STRING(300),
      allowNull: true,
    },
    reporterId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    category: {
      type: DataTypes.STRING(30),
      allowNull: true,
    },
    reason: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    comment: {
      type: DataTypes.STRING(300),
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING,
      defaultValue: 'pending', // pending | reviewed | dismissed
    },
    resolution: {
      type: DataTypes.STRING(300),
      allowNull: true,
    },
    resolvedBy: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    resolvedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: 'content_reports',
    timestamps: true,
  }
);

module.exports = ContentReport;
