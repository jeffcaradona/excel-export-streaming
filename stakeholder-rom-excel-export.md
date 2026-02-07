# Stakeholder Summary — ROM for Streaming Excel Export

## Objective
Enable users to download an Excel export (~30,000 rows) from MSSQL through our Node.js services into a Chrome browser.

The solution will use **streaming**, meaning data is never fully loaded into memory in any layer.

---

## Recommended Approach (High Level)
**MSSQL Stored Procedure → API Service → Front-End Proxy → Browser Download**

- SQL Server streams rows out
- API streams Excel file generation (`.xlsx`)
- Front-end service pipes the file directly to the browser
- Chrome downloads natively

---

## ROM Estimate (Planning Level)
### Expected Effort: **5–7 developer-days**

Includes:
- Creating a new export-focused stored procedure returning rows (not JSON)
- Implementing API streaming Excel generation
- Implementing front-end proxy download route
- Standard production hardening (auth, logging, error handling)
- Performance validation with ~30k row exports

---

## Key Dependency
The current stored procedure returns a JSON string.  
To support true streaming exports, we will likely create a **new version** that returns a normal rowset.

Estimated DB effort: **~1–2 days** (included in ROM).

---

## Benefits
- Reliable downloads for large exports
- Low memory usage across services
- Avoids large JSON payloads in the browser
- Scales beyond 30k rows if needed

---

*This estimate is intended for planning and may adjust if advanced formatting, multi-sheet output, or audit requirements are added.*
