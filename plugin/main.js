// Entry point declared in manifest.xml (<FilePath>main.js</FilePath>).
// DaVinci Resolve launches this file with its bundled Electron runtime.
require('./src/main/app').start({ pluginRoot: __dirname });
