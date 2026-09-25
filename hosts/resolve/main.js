// Entry point declared in manifest.xml (<FilePath>main.js</FilePath>).
// DaVinci Resolve launches this file with its bundled Electron runtime.
// The shared code is shipped in node_modules/core (see scripts/build.sh).
require('./host/app').start({ pluginRoot: __dirname });
