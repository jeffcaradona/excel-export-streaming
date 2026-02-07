# ROM Estimate — Streaming Excel Export Implementation

## Goal
Implement an export pipeline that supports downloading an Excel file (up to ~30,000 rows) using:
- MSSQL Server 2019–2022 stored procedure
- Node.js 22 (ESM) API service
- Node.js front-end/BFF proxy service
- Chrome-based browser download

The design uses **end-to-end streaming**:
**MSSQL → API XLSX Stream → BFF Pipe → Browser Download**

---

## ROM Summary (Order of Magnitude)

### Scenario A — Straightforward Implementation
**~2–4 developer-days**

Assumes:
- Stored procedure updated/added to return a normal result set
- Minimal formatting requirements
- Happy-path streaming download only

Includes:
- New export SP returning rows
- API endpoint streaming MSSQL rows into ExcelJS
- BFF proxy route piping the stream
- Basic browser download UX

---

### Scenario B — Moderate Complexity (Most Likely)
**~4–8 developer-days**

Adds:
- Schema agreement (column ordering, types)
- Parameter handling + validation
- Null/date formatting considerations
- Timeout and performance tuning
- Error handling (DB failures, client disconnects)
- Auth forwarding and security headers

---

### Scenario C — Enterprise / Production-Heavy Export
**~8–15 developer-days**

Adds:
- Multi-sheet support or multiple result sets
- Styling/formatting requirements (currency, headers, widths)
- Audit logging + metrics + alerting
- Load testing + regression testing
- Ops documentation/runbooks

---

## Stored Procedure Impact (Major Swing Factor)

### Preferred Approach — New SP Returning Rows
**DB effort: ~0.5–2 days**

- Create a new export-focused stored procedure
- Return a normal `SELECT` rowset instead of JSON
- Keeps existing JSON SP intact for current consumers
- Enables true streaming and low memory usage

---

### Workaround — Keep JSON SP and Parse in Node
**Adds ~1–3 days + higher risk**

- Requires parsing large JSON payload server-side
- Can introduce memory pressure and slower exports
- Less clean than direct row streaming

---

## Recommended Planning ROM
### Expected Effort: **5–7 developer-days**

Assumes:
- New export stored procedure returning rows
- Production-grade streaming API + proxy
- Standard error handling and performance validation

---

## Next Steps
- Confirm export column schema + ordering
- Implement new export stored procedure variant
- Build API streaming XLSX endpoint
- Build BFF proxy download route
- Add logging, auth forwarding, and timeout tuning
- Validate performance with ~30k row test export
