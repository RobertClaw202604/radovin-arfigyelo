// Radovin árfigyelő – strukturált JSON log (guide §20, P1.6).
//
// Minden log-bejegyzés egy JSON sor: timestamp, szint, esemény + mezők.
// Soha nem írunk ki teljes HTML-t / tokeneket / sütiket / fejlécet; csak
// tartalom-hash-t és rövid, szanitizált diagnosztikát.

'use strict';

function log(event, fields = {}) {
  process.stdout.write(`${JSON.stringify({
    timestamp: new Date().toISOString(),
    level: fields.level || 'info',
    event,
    ...fields,
  })}\n`);
}

module.exports = { log };
