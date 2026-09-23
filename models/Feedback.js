const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// Krótka ankieta "Dołącz do społeczności" na stronie głównej (ocena 1-5 + opcjonalny komentarz).
// Wyniki widoczne w panelu admina (Opinie).
const Feedback = sequelize.define(
  'Feedback',
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
    username: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    rating: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    comment: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
  },
  {
    tableName: 'feedback',
    timestamps: true,
  }
);

module.exports = Feedback;
