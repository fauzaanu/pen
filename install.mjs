#!/usr/bin/env node

import { readFileSync, existsSync, symlinkSync, unlinkSync, lstatSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { createInterface } from "readline";
import { execSync } from "child_process";
import { homedir } from "os";

const PLUGIN_ID = "pen";
const BUILD_DIR = resolve("build");
const OBSIDIAN_CONFIG = join(homedir(), ".config", "obsidian", "obsidian.json");

function getVaults() {
	if (!existsSync(OBSIDIAN_CONFIG)) {
		console.error("Could not find Obsidian config at", OBSIDIAN_CONFIG);
		process.exit(1);
	}
	const config = JSON.parse(readFileSync(OBSIDIAN_CONFIG, "utf-8"));
	return Object.values(config.vaults).map(v => v.path);
}

async function ask(rl, question) {
	return new Promise(resolve => rl.question(question, resolve));
}

async function main() {
	// Build first
	console.log("Building plugin...\n");
	execSync("npm run build", { stdio: "inherit" });

	if (!existsSync(BUILD_DIR)) {
		console.error("\nbuild/ directory not found after build. Something went wrong.");
		process.exit(1);
	}

	const vaults = getVaults();
	if (vaults.length === 0) {
		console.log("No Obsidian vaults found.");
		process.exit(0);
	}

	const rl = createInterface({ input: process.stdin, output: process.stdout });

	console.log(`\nFound ${vaults.length} vault(s). Select which ones to install the plugin in:\n`);

	for (const vault of vaults) {
		const pluginsDir = join(vault, ".obsidian", "plugins");
		const target = join(pluginsDir, PLUGIN_ID);

		// Check if .obsidian exists (valid vault)
		if (!existsSync(join(vault, ".obsidian"))) {
			console.log(`  ⏭  ${vault} — no .obsidian folder, skipping`);
			continue;
		}

		// Show current state
		let status = "";
		if (existsSync(target)) {
			const stat = lstatSync(target);
			if (stat.isSymbolicLink()) {
				status = " (symlink already exists)";
			} else {
				status = " (regular folder exists)";
			}
		}

		const answer = await ask(rl, `  Install in ${vault}?${status} [y/N] `);

		if (answer.trim().toLowerCase() === "y") {
			mkdirSync(pluginsDir, { recursive: true });

			// Remove existing symlink or folder
			if (existsSync(target)) {
				const stat = lstatSync(target);
				if (stat.isSymbolicLink()) {
					unlinkSync(target);
				} else {
					console.log(`    ⚠  ${target} is a regular folder — remove it manually if you want to replace it.`);
					continue;
				}
			}

			symlinkSync(BUILD_DIR, target);
			console.log(`    ✓ Symlinked → ${target}\n`);
		} else {
			console.log(`    — Skipped\n`);
		}
	}

	rl.close();
	console.log("Done.");
}

main();
