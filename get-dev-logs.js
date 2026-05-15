const fs = require('fs');
const cp = require('child_process');
const output = cp.execSync('ps aux | grep "next dev" | grep -v grep').toString();
console.log("Next process:", output);
// Can't easily read from another process's stdout on macOS without attaching
