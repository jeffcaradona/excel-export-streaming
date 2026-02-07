/**
 * Column definitions for spGenerateData stored procedure output
 */
export const REPORT_COLUMNS = [
  { header: 'Id', key: 'Id', width: 10 },
  { header: 'ColInt', key: 'ColInt', width: 12 },
  { header: 'ColBigInt', key: 'ColBigInt', width: 15 },
  { header: 'ColDecimal', key: 'ColDecimal', width: 12 },
  { header: 'ColFloat', key: 'ColFloat', width: 12 },
  { header: 'ColBit', key: 'ColBit', width: 8 },
  { header: 'ColGuid', key: 'ColGuid', width: 38 },
  { header: 'ColDate', key: 'ColDate', width: 20 },
  { header: 'ColVarchar', key: 'ColVarchar', width: 20 },
  { header: 'ColText', key: 'ColText', width: 50 },
  { header: 'ColJson', key: 'ColJson', width: 30 }
];

/**
 * Maps database row to Excel row format
 * @param {Object} row - Database row from stored procedure
 * @returns {Object} Mapped row object for ExcelJS
 */
export const mapRowToExcel = (row) => ({
  Id: row.Id,
  ColInt: row.ColInt,
  ColBigInt: row.ColBigInt,
  ColDecimal: row.ColDecimal,
  ColFloat: row.ColFloat,
  ColBit: row.ColBit,
  ColGuid: row.ColGuid,
  ColDate: row.ColDate,
  ColVarchar: row.ColVarchar,
  ColText: row.ColText,
  ColJson: row.ColJson
});
