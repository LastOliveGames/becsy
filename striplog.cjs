const fs = require('fs');

let log_text = fs.readFileSync("v8.pre.log", "utf8");
let log_lines = log_text.split('\n');

const badLines = /(extensions::SafeBuiltins:)|(v8\/LoadTimes:)/;
// Web servers will have a prefix like: http://localhost:8000/app.js (needs to be just app.js)
// Files from Windows something like: file:///C:/temp/app.js (needs to be just /temp/app.js)
// Files from Linux something like: file:///home/bill/app.js (needs to be just /home/bill/app.js)
const webPrefix = /((https?:\/\/[^\/]*\/)|(file:\/\/\/[a-zA-Z]:)|(file:\/\/))/;

let new_lines = "";
log_lines.forEach( line => {
  // Removes lines containing "extensions::SafeBuiltins:" or "v8/LoadTimes:"
  if (badLines.test(line)) return;
  // Remove the http://localhost:8000/-like prefix.
  const scrubbed_line = line.replace(webPrefix, "");
  new_lines += scrubbed_line + "\n";
});

fs.writeFileSync("v8.log", new_lines);
