const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// Dziennik działań administratorów (kto, co i na czym zrobił).
const AdminLog = sequelize.define(
  'AdminLog',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    adminId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    adminUsername: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    // np. 'user.ban', 'review.delete', 'report.dismiss'
    action: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    targetType: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    targetLabel: {
      type: DataTypes.STRING(200),
      allowNull: true,
    },
    details: {
      type: DataTypes.STRING(300),
      allowNull: true,
    },
  },
  {
    tableName: 'admin_logs',
    timestamps: true,
    updatedAt: false,
  }
);

module.exports = AdminLog;
