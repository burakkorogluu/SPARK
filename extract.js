const fs = require('fs');

const dataJSPath = 'js/data.js';
const content = fs.readFileSync(dataJSPath, 'utf8');

const regex = /const _RAW_DATA = \[([\s\S]*?)\];/m;
const match = content.match(regex);

if (match) {
    const rawArrayStr = '[' + match[1] + ']';
    
    // Evaluate the string to an array (since it's a valid JS literal array, we can use eval or Function safely here as we own the file)
    let parsedArray;
    try {
        parsedArray = new Function('return ' + rawArrayStr + ';')();
    } catch (e) {
        console.error("Parse error:", e);
        process.exit(1);
    }
    
    // Ensure data directory exists
    if (!fs.existsSync('data')) {
        fs.mkdirSync('data');
    }
    
    fs.writeFileSync('data/raw_data.json', JSON.stringify(parsedArray, null, 2));
    
    const newContent = content.replace(regex, 'let _RAW_DATA = [];');
    fs.writeFileSync(dataJSPath, newContent);
    
    console.log(`Extraction complete. Wrote ${parsedArray.length} records to data/raw_data.json`);
} else {
    console.error("Could not find _RAW_DATA array in js/data.js");
}
