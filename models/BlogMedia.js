const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// Biblioteka multimediów bloga: zdjęcia i infografiki wgrane z edytora wpisów. Każdy plik ma domyślny tekst
// alternatywny i podpis, które edytor podpowiada przy ponownym użyciu obrazu.
const BlogMedia = sequelize.define(
  'BlogMedia',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    filename: {
      type: DataTypes.STRING(120),
      allowNull: false,
    },
    url: {
      type: DataTypes.STRING(200),
      allowNull: false,
    },
    alt: {
      type: DataTypes.STRING(300),
      allowNull: false,
      defaultValue: '',
    },
    caption: {
      type: DataTypes.STRING(300),
      allowNull: false,
      defaultValue: '',
    },
    width: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    height: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    sizeBytes: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    originalName: {
      type: DataTypes.STRING(200),
      allowNull: true,
    },
    uploadedBy: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  },
  {
    tableName: 'blog_media',
    timestamps: true,
  }
);

module.exports = BlogMedia;
