const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// Propozycje funkcji dodane przez administratorów (panel -> Propozycje).
// Decyzje (przyjęte / odłożone / odrzucone) zapisują się w ustawieniach serwisu pod kluczem "idea:<id>".
const AdminIdea = sequelize.define(
  'AdminIdea',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    title: {
      type: DataTypes.STRING(120),
      allowNull: false,
    },
    description: {
      type: DataTypes.STRING(800),
      allowNull: false,
    },
    // security | usability
    area: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'usability',
    },
    effort: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'średni',
    },
    impact: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'średni',
    },
    authorId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    authorName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
  },
  {
    tableName: 'admin_ideas',
    timestamps: true,
  }
);

module.exports = AdminIdea;
