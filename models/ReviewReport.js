const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// Zgłoszenia trafiają tutaj jako "poczekalnia" do moderacji. Panel admina
// do ich przeglądania to osobna funkcja na później - na razie zapisujemy
// zgłoszenie i dziękujemy użytkownikowi.
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
    reason: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING,
      defaultValue: 'pending', // pending | reviewed | dismissed
    },
  },
  {
    tableName: 'review_reports',
    timestamps: true,
  }
);

module.exports = ReviewReport;