#!/usr/bin/env node
// Thin wrapper to allow: node vidmoly.js <user> <pass> <file>
const { spawn } = require('child_process');
const path = require('path');
const args = process.argv.slice(2);
const target = path.join(__dirname, 'scripts', 'vidmoly.js');
const child = spawn(process.execPath, [target, ...args], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code));

