const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// Zgłoszenia recenzji trafiają tutaj jako kolejka do moderacji (panel admina -> Zgłoszenia).
const ReviewReport = sequelize.define(
  'ReviewReport',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    reviewId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    reporterId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    // Czytelna nazwa wybranego powodu (np. "Spam lub reklama").
    reason: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    // Identyfikator powodu z utils/reportReasons.js.
    category: {
      type: DataTypes.STRING(30),
      allowNull: true,
    },
    // Dopisek zgłaszającego.
    comment: {
      type: DataTypes.STRING(300),
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING,
      defaultValue: 'pending', // pending | reviewed | dismissed
    },
    // Uzasadnienie decyzji administratora (przy odrzuceniu obowiązkowe).
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
    tableName: 'review_reports',
    timestamps: true,
  }
);

module.exports = ReviewReport;