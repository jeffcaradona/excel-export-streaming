# Excel Export Streaming Plan (High-Level)

## Goal
Generate and download an Excel file (up to ~30,000 rows) from MSSQL through two Node.js web services into a Chrome-based browser.

This approach avoids loading all records into memory at any layer.

---

## Architecture Overview
**MSSQL Stored Procedure → API Service → Front-End Web Service (BFF) → Browser Download**

---

## Key Design Principles

### Stream Everything
- Do not return 30k rows as JSON.
- Do not buffer results in memory.
- Stream rows from SQL Server.
- Stream-write the XLSX file directly to the HTTP response.

### Server-Side File Generation
- Excel files should be generated in the API layer using a streaming writer.
- Browser should only receive bytes as a file download.

### Proxy Streaming Between Services
- The front-end web service should pipe the response.
- It should not download the file first and then re-upload it.

---

## Flow Summary
1. User clicks **Export Excel** in Chrome.
2. Browser navigates to `/exports/report`.
3. Front-End Web Service proxies request to API.
4. API executes MSSQL stored procedure with streaming enabled.
5. Rows stream out of SQL Server.
6. API streams rows into ExcelJS workbook writer.
7. Workbook is streamed back as an `.xlsx` attachment.
8. Front-End pipes the stream to the browser.
9. Chrome downloads file normally.

---

## Technology Assumptions
- Node.js 22 (ESM modules)
- MSSQL Server 2019–2022
- Stored procedure already written (but may need a new rowset-returning version)
- Excel generation via `exceljs` streaming writer
- Chrome-based browser download behavior

---

## Benefits
- Low memory usage across services
- No large JSON payloads
- Fast and reliable export for 30k+ rows
- Browser download works natively

---

## Next Steps
- Implement API export endpoint (`/export/report`)
- Implement BFF proxy route (`/exports/report`)
- Confirm stored procedure column mappings and parameters
- Add logging + error handling for stream failures / client aborts
- Optionally support multi-sheet or CSV fallback
