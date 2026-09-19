/**
 * sequelize.sync() tworzy brakujące tabele, ale nie dodaje nowych kolumn do
 * już istniejących. Ta funkcja dokłada do istniejących tabel kolumny, które
 * są w modelach, a których jeszcze nie ma w bazie (np. users.points).
 */
const { sequelize } = require('../config/database');

async function addMissingColumns() {
  const queryInterface = sequelize.getQueryInterface();

  for (const model of Object.values(sequelize.models)) {
    const tableName = model.getTableName();
    try {
      const existing = await queryInterface.describeTable(tableName);
      for (const [name, attribute] of Object.entries(model.rawAttributes)) {
        if (attribute.primaryKey || existing[attribute.field || name]) continue;
        await queryInterface.addColumn(tableName, attribute.field || name, attribute);
        console.log(`Dodano brakującą kolumnę ${tableName}.${name}.`);
      }
    } catch (err) {
      console.warn(`Nie udało się sprawdzić kolumn tabeli ${tableName}:`, err.message);
    }
  }
}

module.exports = { addMissingColumns };
